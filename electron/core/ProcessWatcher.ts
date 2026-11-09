import { execFile } from 'node:child_process';
import type { SessionHub } from './SessionHub.js';

export class ProcessWatcher {
  private sessionHub: SessionHub;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isScanning = false;

  constructor(sessionHub: SessionHub) {
    this.sessionHub = sessionHub;
  }

  public start(): void {
    // 首次全量扫描一次
    this.scanCLIProcesses();

    // 每 15 秒做一次低频新进程感知（而非之前的 5 秒高频高开销）
    this.intervalTimer = setInterval(() => {
      this.checkAliveAndScan();
    }, 15000);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private checkAliveAndScan(): void {
    // 1. 先用零系统开销的 process.kill(pid, 0) 探测已登记的 PID 是否存活
    const allSessions = this.sessionHub.getAllSessions();
    for (const session of allSessions) {
      if (session.pid && session.pid > 0) {
        try {
          process.kill(session.pid, 0); // 存活
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            // 进程已退出，直接从活跃会话中注销，杜绝死尸会话
            this.sessionHub.removeSession(session.id);
          }
        }
      } else if (session.source === 'log' && (Date.now() - session.startTime) > 180000) {
        // 超过 3 分钟无实际变动且无进程依附的静态日志会话，自动移出活跃面板
        this.sessionHub.removeSession(session.id);
      }
    }

    // 2. 检查是否有新启动的未通过 hook 上报的 Agent 进程
    this.scanCLIProcesses();
  }

  private scanCLIProcesses(): void {
    if (this.isScanning) return;
    this.isScanning = true;

    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (err, stdout) => {
      this.isScanning = false;
      if (err || !stdout) return;

      const lines = stdout.split('\r\n');
      for (const line of lines) {
        let agentName = '';
        let agentType: 'claude' | 'antigravity' | 'opencode' | 'hermes' | null = null;

        if (/^"(agy|Antigravity)\.exe"/i.test(line)) {
          agentName = 'Google Antigravity';
          agentType = 'antigravity';
        } else if (/^"opencode\.exe"/i.test(line)) {
          agentName = 'OpenCode';
          agentType = 'opencode';
        } else if (/^"(claude|claude-code)\.exe"/i.test(line)) {
          agentName = 'Claude Code';
          agentType = 'claude';
        } else if (/^"(hermes|hermes-agent|hermes-acp)\.exe"/i.test(line)) {
          agentName = 'Hermes Agent';
          agentType = 'hermes';
        }

        if (agentName && agentType) {
          const match = line.match(/^"[^"]+","(\d+)"/);
          if (match) {
            const pid = parseInt(match[1], 10);
            // 1. 检查该 PID 是否已经被某个会话持有
            const alreadyBound = this.sessionHub.getAllSessions().find(s => s.pid === pid);
            if (alreadyBound) {
              continue;
            }

            // 2. 检查是否有同类型但尚未绑定 PID 的会话进行 1:1 配对
            const unboundSession = this.sessionHub.getAllSessions().find(s => s.agentType === agentType && !s.pid);
            if (unboundSession) {
              this.sessionHub.upsertSession({
                id: unboundSession.id,
                pid,
              });
            } else {
              // 3. 所有已有同类会话均已占用不同 PID，说明这是一个新并发启动的同类独立终端窗口！
              const sessionId = `${agentType}-${pid}`;
              const existing = this.sessionHub.getSession(sessionId);
              if (!existing) {
                this.sessionHub.upsertSession({
                  id: sessionId,
                  sessionId,
                  name: `${agentName} (#${pid})`,
                  agentType,
                  status: 'completed',
                  lastMessage: `${agentName} 终端就绪 (等待输入指令)`,
                  pid,
                  source: 'process',
                });
              }
            }
          }
        }
      }
    });
  }
}
