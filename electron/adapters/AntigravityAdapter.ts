import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { AgentAdapter, AgentInstance, DecisionPayload, AgentStatus } from './types.js';
import type { SessionHub } from '../core/SessionHub.js';
import type { TelemetryService } from '../services/TelemetryService.js';

export class AntigravityAdapter implements AgentAdapter {
  readonly id = 'antigravity';
  readonly displayName = 'Google Antigravity';
  readonly agentType = 'antigravity';

  private brainDir: string;
  private watcher: fs.FSWatcher | null = null;
  private sessionHub: SessionHub;
  private telemetryService?: TelemetryService;
  private refreshTimeout: NodeJS.Timeout | null = null;

  constructor(sessionHub: SessionHub, telemetryService?: TelemetryService) {
    this.sessionHub = sessionHub;
    this.telemetryService = telemetryService;
    this.brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  }

  public async init(): Promise<void> {
    this.scanAndSync();
    try {
      if (fs.existsSync(this.brainDir)) {
        this.watcher = fs.watch(this.brainDir, { recursive: true }, (_, filename) => {
          if (filename && (filename.endsWith('transcript.jsonl') || filename.includes('transcript'))) {
            this.debounceScan();
          }
        });
      }
    } catch (e) {
      console.warn('[AntigravityAdapter] 文件监听异常:', e);
    }
  }

  public async destroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  private debounceScan() {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => {
      this.scanAndSync();
    }, 80);
  }

  public scanAndSync(): void {
    if (!fs.existsSync(this.brainDir)) return;

    try {
      const subdirs = fs.readdirSync(this.brainDir);
      const sessions = subdirs
        .map(d => {
          const logFile = path.join(this.brainDir, d, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(logFile)) {
            const stat = fs.statSync(logFile);
            return { id: d, logFile, mtime: stat.mtimeMs };
          }
          return null;
        })
        .filter((item): item is { id: string; logFile: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime);

      if (sessions.length === 0) return;

      // 支持同类型多终端多窗口并发：解析所有最近活跃的会话（最多保留前 5 个）
      const activeSessions = sessions.filter(s => (Date.now() - s.mtime) < 180000).slice(0, 5);
      if (activeSessions.length === 0 && sessions.length > 0) {
        activeSessions.push(sessions[0]);
      }

      for (const s of activeSessions) {
        const isRecentlyActive = (Date.now() - s.mtime) < 45000;
        const isStale = (Date.now() - s.mtime) > 300000;
        if (!isStale) {
          this.parseSessionLog(s.id, s.logFile, s.mtime, isRecentlyActive);
        }
      }
    } catch (err) {
      console.warn('[AntigravityAdapter] 扫描日志出错:', err);
    }
  }

  private parseSessionLog(sessionId: string, logFile: string, mtime: number, isRecentlyActive: boolean) {
    const instanceId = `agy-${sessionId.slice(0, 8)}`;

    try {
      const content = fs.readFileSync(logFile, 'utf-8').trim();
      if (!content) return;

      const lines = content.split('\n');
      const lastLineStr = lines[lines.length - 1];
      const lastObj = JSON.parse(lastLineStr);

      let status: AgentStatus = 'completed';
      let message = '会话就绪 / 空闲中...';
      let decision: DecisionPayload | null = null;
      const stepCount = lines.length;

      // 统计 Google Antigravity 本次会话全部 Token 消耗
      let sessionInputTokens = 0;
      let sessionOutputTokens = 0;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.input_tokens || item.output_tokens || item.cache_read_tokens) {
            sessionInputTokens += (item.input_tokens || 0) + (item.cache_read_tokens || 0);
            sessionOutputTokens += item.output_tokens || 0;
          }
        } catch {}
      }

      if (this.telemetryService && (sessionInputTokens > 0 || sessionOutputTokens > 0)) {
        this.telemetryService.recordSessionTokens(instanceId, sessionInputTokens, sessionOutputTokens, 'gemini-pro');
      }

      // 只有在最近 45 秒内有实时文件变动，才可能是运行中或真正等待审批
      if (isRecentlyActive) {
        if (lastObj.type === 'USER_INPUT') {
          status = 'running';
          message = '正在思考与处理用户需求...';
        } else if (lastObj.type === 'GENERIC' || lastObj.type === 'SYSTEM_MESSAGE') {
          // 工具执行完毕返回结果，或者系统异步消息通知，Agent 正在消化上下文进行下一步推理
          status = 'running';
          message = '已获取执行结果，正在分析与规划...';
        } else if (lastObj.type === 'PLANNER_RESPONSE') {
          const toolCalls = lastObj.tool_calls || [];
          const lastTool = toolCalls[toolCalls.length - 1];

          if (lastTool) {
            if (lastTool.name === 'ask_question') {
              status = 'waiting';
              message = '等待用户回答提问...';
              const qData = lastTool.arguments || lastTool.args || {};
              const questions = qData.questions || [];
              const firstQ = questions[0] || {};

              decision = {
                request_id: `agy-q-${sessionId.slice(0, 8)}`,
                session_id: instanceId,
                agent_name: 'Google Antigravity',
                tool_name: 'ask_question',
                type: 'question',
                question: firstQ.question || 'Antigravity 需要您提供设计决策',
                options: firstQ.options || ['确认继续', '需要调整'],
                timestamp: Date.now(),
              };
            } else if (lastTool.name === 'run_command') {
              const cmdArgs = lastTool.arguments || lastTool.args || {};
              const cmd = cmdArgs.CommandLine || '';
              // 只有当还在最近 20 秒内且工具调用刚发出时才可能是待决
              if ((Date.now() - mtime) < 20000) {
                status = 'waiting';
                message = `等待终端指令审批: ${cmd.slice(0, 30)}...`;

                decision = {
                  request_id: `agy-cmd-${sessionId.slice(0, 8)}`,
                  session_id: instanceId,
                  agent_name: 'Google Antigravity',
                  tool_name: 'run_command',
                  type: 'approval',
                  command: cmd,
                  timestamp: Date.now(),
                };
              } else {
                status = 'running';
                message = `正在执行命令: ${cmd.slice(0, 30)}...`;
              }
            } else if (lastTool.name === 'invoke_subagent') {
              status = 'running';
              const subagent = lastTool.arguments?.Role || lastTool.arguments?.TypeName || 'Subagent';
              message = `正在调度并行子 Agent: [${subagent}]`;
            } else if (lastTool.name === 'read_file') {
              status = 'running';
              const p = lastTool.arguments?.Path ? path.basename(lastTool.arguments.Path) : '文件';
              message = `正在阅读文件: ${p}`;
            } else if (lastTool.name === 'write_file' || lastTool.name === 'edit_file') {
              status = 'running';
              const p = lastTool.arguments?.Path ? path.basename(lastTool.arguments.Path) : '文件';
              message = `正在修改文件: ${p}`;
            } else {
              status = 'running';
              message = `正在执行工具: ${lastTool.name}...`;
            }
          } else {
            // 没有待决 tool_calls，说明本轮模型回答完成，等待用户下一轮指令
            status = 'completed';
            message = '任务已交付，等待下一步指令';
          }
        } else if (lastObj.type === 'ERROR_MESSAGE') {
          status = 'error';
          message = 'Agent 执行遇到错误';
        } else {
          status = 'running';
          message = '正在执行任务流程...';
        }
      } else {
        // 非最近活跃会话，一律为 completed 或空闲
        status = 'completed';
        message = '任务已交付，等待下一步指令';
      }

      const existingSession = this.sessionHub.getSession(instanceId);
      let pid = existingSession?.pid;
      if (!pid) {
        const placeholder = this.sessionHub.getAllSessions().find(s => s.agentType === 'antigravity' && s.pid && s.source === 'process');
        if (placeholder && placeholder.pid) {
          pid = placeholder.pid;
          this.sessionHub.removeSession(placeholder.id);
        }
      }
      if (decision && pid) {
        decision.pid = pid;
      }

      const instance: AgentInstance = {
        id: instanceId,
        sessionId,
        name: `Google Antigravity (${sessionId.slice(0, 6)})`,
        agentType: 'antigravity',
        status,
        lastMessage: message,
        startTime: mtime,
        pid,
        source: 'log',
        metrics: {
          stepCount,
        },
      };

      this.sessionHub.upsertSession(instance);

      // 如果不是真正等待中，确保从决策队列清理该会话之前的请求
      if (decision && status === 'waiting') {
        this.sessionHub.enqueueDecision(decision);
      } else {
        this.sessionHub.resolveDecision(`agy-cmd-${sessionId.slice(0, 8)}`, 'dismiss' as any);
        this.sessionHub.resolveDecision(`agy-q-${sessionId.slice(0, 8)}`, 'dismiss' as any);
      }
    } catch {}
  }
}
