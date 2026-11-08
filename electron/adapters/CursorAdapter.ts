import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { AgentAdapter, AgentInstance } from './types.js';
import type { SessionHub } from '../core/SessionHub.js';

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  readonly displayName = 'Cursor Agent';
  readonly agentType = 'cursor';

  private sessionHub: SessionHub;
  private cursorLogsDir: string;
  private watcher: fs.FSWatcher | null = null;

  constructor(sessionHub: SessionHub) {
    this.sessionHub = sessionHub;
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    this.cursorLogsDir = path.join(appData, 'Cursor', 'logs');
  }

  public async init(): Promise<void> {
    this.checkCursorStatus();
    try {
      if (fs.existsSync(this.cursorLogsDir)) {
        this.watcher = fs.watch(this.cursorLogsDir, { recursive: true }, () => {
          this.checkCursorStatus();
        });
      }
    } catch {}
  }

  public async destroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  public checkCursorStatus(): void {
    if (!fs.existsSync(this.cursorLogsDir)) return;

    try {
      // 嗅探最近更新的会话日志
      const files = fs.readdirSync(this.cursorLogsDir)
        .map(f => {
          const p = path.join(this.cursorLogsDir, f);
          try {
            return { file: p, mtime: fs.statSync(p).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { file: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return;

      const latest = files[0];
      const isRecent = (Date.now() - latest.mtime) < 20000;

      if (isRecent) {
        const instance: AgentInstance = {
          id: 'cursor-agent-active',
          sessionId: 'cursor-agent-active',
          name: 'Cursor Composer Agent',
          agentType: 'cursor',
          status: 'running',
          lastMessage: 'Cursor 后台代码生成与索引中...',
          startTime: latest.mtime,
          source: 'log',
        };
        this.sessionHub.upsertSession(instance);
      }
    } catch {}
  }
}
