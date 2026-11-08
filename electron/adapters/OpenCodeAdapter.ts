import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { AgentAdapter, AgentInstance } from './types.js';
import type { SessionHub } from '../core/SessionHub.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly agentType = 'opencode';

  private logPath: string;
  private watcher: fs.FSWatcher | null = null;
  private sessionHub: SessionHub;

  constructor(sessionHub: SessionHub) {
    this.sessionHub = sessionHub;
    this.logPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'log', 'opencode.log');
  }

  public async init(): Promise<void> {
    this.checkStatus();
    try {
      const logDir = path.dirname(this.logPath);
      if (fs.existsSync(logDir)) {
        this.watcher = fs.watch(logDir, () => this.checkStatus());
      }
    } catch {}
  }

  public async destroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  public checkStatus(): void {
    if (!fs.existsSync(this.logPath)) return;

    try {
      const stats = fs.statSync(this.logPath);
      const isRecent = (Date.now() - stats.mtimeMs) < 30000;

      // 若历史日志很久未变动且无实时进程关联，从活跃列表中清理，杜绝虚报会话数
      if (!isRecent) {
        const existing = this.sessionHub.getSession('opencode-main');
        if (existing && !existing.pid) {
          this.sessionHub.removeSession('opencode-main');
        }
        return;
      }

      const fd = fs.openSync(this.logPath, 'r');
      const bufferSize = Math.min(stats.size, 4096);
      const buffer = Buffer.alloc(bufferSize);
      fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
      fs.closeSync(fd);
      const logContent = buffer.toString('utf-8');

      let status: 'running' | 'waiting' | 'completed' | 'error' = 'completed';
      let message = 'OpenCode 终端就绪，等待输入指令';

      if (/message="stream error"|AI_APICallError|Error:|ConnectEx failed/i.test(logContent)) {
        status = 'error';
        message = '模型调用异常 / API 连接失败';
      } else if (isRecent) {
        if (/message="stream"|message=stream/i.test(logContent)) {
          status = 'running';
          message = '正在进行流式代码生成与推理...';
        } else if (/creating instance|bootstrapping/i.test(logContent)) {
          status = 'running';
          message = '正在初始化工作区环境...';
        } else {
          status = 'completed';
          message = '任务已完成，等待下一条指令';
        }
      }

      const instance: AgentInstance = {
        id: 'opencode-main',
        sessionId: 'opencode-main',
        name: 'OpenCode',
        agentType: 'opencode',
        status,
        lastMessage: message,
        startTime: stats.mtimeMs,
        source: 'log',
      };

      this.sessionHub.upsertSession(instance);
    } catch {}
  }
}
