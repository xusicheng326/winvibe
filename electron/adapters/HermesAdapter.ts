import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { AgentAdapter, AgentInstance } from './types.js';
import type { SessionHub } from '../core/SessionHub.js';

export class HermesAdapter implements AgentAdapter {
  readonly id = 'hermes';
  readonly displayName = 'Hermes Agent';
  readonly agentType = 'hermes';

  private logPath: string;
  private watcher: fs.FSWatcher | null = null;
  private sessionHub: SessionHub;

  constructor(sessionHub: SessionHub) {
    this.sessionHub = sessionHub;
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.logPath = path.join(localAppData, 'hermes', 'logs', 'agent.log');
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

      if (!isRecent) {
        const existing = this.sessionHub.getSession('hermes-main');
        if (existing && !existing.pid) {
          this.sessionHub.removeSession('hermes-main');
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
      let message = 'Hermes 终端会话就绪...';

      if (isRecent) {
        if (/Streaming|tool_call/i.test(logContent)) {
          status = 'running';
          message = '正在执行工具与上下文推演...';
        } else if (/Error|failed/i.test(logContent)) {
          status = 'error';
          message = 'API 调用异常，已暂停...';
        } else {
          status = 'completed';
          message = '执行就绪，等待下一次唤起';
        }

        const instance: AgentInstance = {
          id: 'hermes-main',
          sessionId: 'hermes-main',
          name: 'Hermes Agent',
          agentType: 'hermes',
          status,
          lastMessage: message,
          startTime: stats.mtimeMs,
          source: 'log',
        };

        this.sessionHub.upsertSession(instance);
      }
    } catch {}
  }
}
