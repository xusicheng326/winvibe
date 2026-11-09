import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { AgentAdapter, AgentInstance, AgentStatus, DecisionPayload } from './types.js';
import type { SessionHub } from '../core/SessionHub.js';
import type { TelemetryService } from '../services/TelemetryService.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly agentType = 'opencode';

  private logPath: string;
  private dbPath: string;
  private watcher: fs.FSWatcher | null = null;
  private sessionHub: SessionHub;
  private telemetryService?: TelemetryService;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private dampingTimer: NodeJS.Timeout | null = null;
  private lastRunningStartTime = 0;
  private lastKnownLogMtime = 0;
  private lastKnownDbMtime = 0;

  constructor(sessionHub: SessionHub, telemetryService?: TelemetryService) {
    this.sessionHub = sessionHub;
    this.telemetryService = telemetryService;
    this.logPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'log', 'opencode.log');
    this.dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  public async init(): Promise<void> {
    this.checkStatus();
    try {
      const shareDir = path.dirname(this.dbPath);
      if (fs.existsSync(shareDir)) {
        this.watcher = fs.watch(shareDir, { recursive: true }, (_, filename) => {
          if (!filename || filename.includes('opencode.log') || filename.includes('opencode.db')) {
            this.debounceCheck();
          }
        });
      }
    } catch (e) {
      console.warn('[OpenCodeAdapter] 文件监听异常:', e);
    }

    // 高频轻量心跳（每 400ms）：解决 Windows 文件系统在本地小模型极速写入时的事件吞噬与延迟
    this.heartbeatTimer = setInterval(() => {
      this.pollHeartbeat();
    }, 400);
  }

  public async destroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.dampingTimer) {
      clearTimeout(this.dampingTimer);
      this.dampingTimer = null;
    }
  }

  private pollHeartbeat(): void {
    try {
      let changed = false;
      if (fs.existsSync(this.logPath)) {
        const stat = fs.statSync(this.logPath);
        if (stat.mtimeMs !== this.lastKnownLogMtime) {
          this.lastKnownLogMtime = stat.mtimeMs;
          changed = true;
        }
      }
      if (fs.existsSync(this.dbPath)) {
        const stat = fs.statSync(this.dbPath);
        if (stat.mtimeMs !== this.lastKnownDbMtime) {
          this.lastKnownDbMtime = stat.mtimeMs;
          changed = true;
        }
      }
      if (changed) {
        this.checkStatus();
      }
    } catch {}
  }

  private debounceCheck(): void {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => {
      this.checkStatus();
    }, 30);
  }

  public checkStatus(): void {
    if (!fs.existsSync(this.logPath) && !fs.existsSync(this.dbPath)) return;

    try {
      let logMtime = 0;
      let dbMtime = 0;

      if (fs.existsSync(this.logPath)) {
        logMtime = fs.statSync(this.logPath).mtimeMs;
        this.lastKnownLogMtime = logMtime;
      }
      if (fs.existsSync(this.dbPath)) {
        dbMtime = fs.statSync(this.dbPath).mtimeMs;
        this.lastKnownDbMtime = dbMtime;
      }

      const latestMtime = Math.max(logMtime, dbMtime);
      const isRecentlyActive = (Date.now() - latestMtime) < 45000;
      const isStale = (Date.now() - latestMtime) > 300000;

      // 绑定进程 PID
      const existingSameType = this.sessionHub.getAllSessions().find(s => s.agentType === 'opencode' && s.pid);
      const pid = existingSameType?.pid;

      // 如果超过 5 分钟无任何活动且无进程绑定，清理残留日志会话
      if (isStale && !pid) {
        const allSessions = this.sessionHub.getAllSessions();
        for (const s of allSessions) {
          if (s.agentType === 'opencode' && s.source === 'log') {
            this.sessionHub.removeSession(s.id);
          }
        }
        return;
      }

      // 1. 尝试从 SQLite 读取权威会话元数据（工作区目录、Token、会话ID）
      let dbMeta: {
        id?: string;
        directory?: string;
        title?: string;
        tokensInput?: number;
        tokensOutput?: number;
        modelId?: string;
      } | null = null;

      try {
        const { DatabaseSync } = require('node:sqlite');
        if (fs.existsSync(this.dbPath)) {
          const db = new DatabaseSync(this.dbPath, { open: true, readOnly: true });
          const row: any = db.prepare('SELECT id, directory, title, model, tokens_input, tokens_output, time_updated FROM session ORDER BY time_updated DESC LIMIT 1').get();
          db.close();

          if (row) {
            let modelId = 'qwen';
            try {
              if (row.model) {
                const parsedModel = typeof row.model === 'string' ? JSON.parse(row.model) : row.model;
                modelId = parsedModel.id || parsedModel.name || modelId;
              }
            } catch {}

            dbMeta = {
              id: row.id,
              directory: row.directory,
              title: row.title,
              tokensInput: row.tokens_input || 0,
              tokensOutput: row.tokens_output || 0,
              modelId,
            };
          }
        }
      } catch {}

      // 2. 倒序流式解析 opencode.log（提取最新原子事件，解决 4KB 缓冲全量匹配假阳性）
      let rawSessionId = dbMeta?.id || '';
      let directory = dbMeta?.directory || '';
      let detectedModel = dbMeta?.modelId || '';
      let status: AgentStatus = 'completed';
      let message = 'OpenCode 终端就绪 (等待输入指令)';

      if (fs.existsSync(this.logPath)) {
        const stats = fs.statSync(this.logPath);
        const bufferSize = Math.min(stats.size, 65536);
        const buffer = Buffer.alloc(bufferSize);
        const fd = fs.openSync(this.logPath, 'r');
        fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
        fs.closeSync(fd);

        const content = buffer.toString('utf-8');
        const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

        let determined = false;

        // 自底向上倒序扫描最后发生的关键事件
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];

          // 补充元数据
          if (!rawSessionId) {
            const sidMatch = line.match(/session\.id=([a-zA-Z0-9_-]+)/) || line.match(/id=(ses_[a-zA-Z0-9_-]+)/);
            if (sidMatch) rawSessionId = sidMatch[1];
          }
          if (!directory) {
            const dirMatch = line.match(/directory="([^"]+)"/);
            if (dirMatch) directory = dirMatch[1];
          }
          if (!detectedModel) {
            const modelMatch = line.match(/model\.id=([a-zA-Z0-9_:.-]+)/) || line.match(/modelID=([a-zA-Z0-9_:.-]+)/);
            if (modelMatch) detectedModel = modelMatch[1];
          }

          if (determined) continue;

          // 核心事件 A：回合已结束
          if (line.includes('message="exiting loop"')) {
            // 状态阻尼守护 (State Damping Guard)：
            // 本地小模型 (Ollama) 推理极快 (常在 1 秒内完成)，若刚进入 running 状态不足 1.5 秒，
            // 强制维持 running 视觉反馈，并在到期后平滑收敛为 completed，彻底防止用户感觉“没变/一直卡在已交付”
            const elapsedSinceRunning = Date.now() - this.lastRunningStartTime;
            if (this.lastRunningStartTime > 0 && elapsedSinceRunning < 1500) {
              status = 'running';
              message = `正在进行流式代码生成与推理... (${detectedModel || '本地模型'})`;
              if (!this.dampingTimer) {
                this.dampingTimer = setTimeout(() => {
                  this.dampingTimer = null;
                  this.checkStatus();
                }, 1500 - elapsedSinceRunning);
              }
            } else {
              status = 'completed';
              message = 'OpenCode 终端就绪 (等待输入指令)';
            }
            determined = true;
          }
          // 核心事件 B：LLM 正在流式推理或开始处理 prompt
          else if (
            line.includes('message=stream') ||
            line.includes('message="stream"') ||
            line.includes('message=process')
          ) {
            if (isRecentlyActive) {
              if (this.lastRunningStartTime === 0 || Date.now() - this.lastRunningStartTime > 30000) {
                this.lastRunningStartTime = Date.now();
              }
              if (this.dampingTimer) {
                clearTimeout(this.dampingTimer);
                this.dampingTimer = null;
              }
              status = 'running';
              message = `正在进行流式代码生成与推理... (${detectedModel || '本地模型'})`;
            } else {
              status = 'completed';
              message = 'OpenCode 终端就绪 (等待输入指令)';
            }
            determined = true;
          }
          // 核心事件 C：执行 Shell 工具
          else if (line.includes('message="shell tool using shell"') || line.includes('tool=bash') || line.includes('tool="bash"')) {
            if (isRecentlyActive) {
              status = 'running';
              message = '正在执行终端命令...';
            } else {
              status = 'completed';
              message = 'OpenCode 终端就绪 (等待输入指令)';
            }
            determined = true;
          }
          // 核心事件 D：真实致命错误（排除 models.dev 等非致命启动网络告警）
          else if (
            line.includes('level=ERROR') &&
            (line.includes('stream error') || line.includes('AI_APICallError') || line.includes('ConnectEx failed'))
          ) {
            status = 'error';
            message = '模型调用异常 / API 连接失败';
            determined = true;
          }
          // 核心事件 E：环境初始化
          else if (line.includes('message="creating instance"') || line.includes('message=bootstrapping')) {
            if (isRecentlyActive) {
              status = 'running';
              message = '正在初始化工作区环境...';
            } else {
              status = 'completed';
              message = 'OpenCode 终端就绪 (等待输入指令)';
            }
            determined = true;
          }
        }
      }

      // 非最近活跃会话一律收敛为 completed / idle
      if (!isRecentlyActive) {
        status = 'completed';
        message = 'OpenCode 终端就绪 (等待输入指令)';
      }

      // 会话命名与 CWD 目录感知
      const dirName = directory ? path.basename(directory.replace(/\\/g, '/')) : '';
      const displayId = rawSessionId ? `opencode-${rawSessionId.slice(0, 8)}` : 'opencode-main';
      const displayName = dirName ? `OpenCode (${dirName})` : 'OpenCode';

      // 遥测 Token 消耗上报
      if (this.telemetryService && dbMeta && (dbMeta.tokensInput || dbMeta.tokensOutput)) {
        this.telemetryService.recordSessionTokens(
          displayId,
          dbMeta.tokensInput || 0,
          dbMeta.tokensOutput || 0,
          dbMeta.modelId || 'opencode-model'
        );
      }

      const instance: AgentInstance = {
        id: displayId,
        sessionId: rawSessionId || displayId,
        name: displayName,
        agentType: 'opencode',
        status,
        lastMessage: message,
        startTime: latestMtime,
        pid,
        cwd: directory || undefined,
        source: 'log',
        metrics: dbMeta ? {
          inputTokens: dbMeta.tokensInput,
          outputTokens: dbMeta.tokensOutput,
          totalTokens: (dbMeta.tokensInput || 0) + (dbMeta.tokensOutput || 0),
        } : undefined,
      };

      this.sessionHub.upsertSession(instance);
    } catch (err) {
      console.warn('[OpenCodeAdapter] 状态感知异常:', err);
    }
  }
}
