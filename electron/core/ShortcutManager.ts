import { globalShortcut } from 'electron';
import type { WindowManager } from './WindowManager.js';
import type { SessionHub } from './SessionHub.js';

export class ShortcutManager {
  private windowManager: WindowManager;
  private sessionHub: SessionHub;
  private lastTriggerTime = 0;

  constructor(windowManager: WindowManager, sessionHub: SessionHub) {
    this.windowManager = windowManager;
    this.sessionHub = sessionHub;
  }

  public register(): void {
    // 展开/收起控制台全局快捷键
    globalShortcut.register('Alt+V', () => {
      this.windowManager.sendToRenderer('toggle-expand');
    });

    // 核心恢复：系统级全局审批热键 Alt+Y (批准) 与 Alt+N (拒绝)
    // 无论当前焦点在浏览器、VS Code 还是其它任意窗口，均可全局一键响应放行
    globalShortcut.register('Alt+Y', () => {
      this.handleAction('allow');
    });

    globalShortcut.register('Alt+N', () => {
      this.handleAction('deny');
    });
  }

  public unregister(): void {
    globalShortcut.unregisterAll();
  }

  private handleAction(action: 'allow' | 'deny') {
    const now = Date.now();
    if (now - this.lastTriggerTime < 180) return;
    this.lastTriggerTime = now;

    // 1. 界面瞬时 0 延迟响应第一次按键，绝对杜绝“必须按两次才反应”
    this.windowManager.sendToRenderer('shortcut-decision', action);

    // 2. 底层终端发键仲裁
    const result = this.sessionHub.resolveTargetOrHead(action);
    const displayName = result.targetSession?.name || 'Google Antigravity';
    this.windowManager.sendToRenderer('agent-quick-feedback', {
      action,
      agentName: displayName,
      key: action === 'allow' ? 'Y' : 'N',
    });
  }
}
