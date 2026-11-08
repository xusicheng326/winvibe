import { Tray, Menu, nativeImage, app, type NativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WindowManager } from './WindowManager.js';
import type { SessionHub } from './SessionHub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TrayManager {
  private tray: Tray | null = null;
  private windowManager: WindowManager;
  private sessionHub: SessionHub;

  constructor(windowManager: WindowManager, sessionHub: SessionHub) {
    this.windowManager = windowManager;
    this.sessionHub = sessionHub;
  }

  public init(): void {
    const iconCandidates = [
      path.join(__dirname, '../tray-icon.png'),
      path.join(__dirname, 'tray-icon.png'),
      path.join(app.getAppPath(), 'electron', 'tray-icon.png'),
      path.join(app.getAppPath(), 'dist-electron', 'tray-icon.png'),
      'D:\\vibe\\agent\\electron\\tray-icon.png',
    ];

    let iconPath = '';
    for (const p of iconCandidates) {
      if (fs.existsSync(p)) {
        iconPath = p;
        break;
      }
    }

    let icon: NativeImage;
    if (iconPath) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('WinVibe - AI Agent 灵动岛控制台');

    this.updateMenu();
    this.tray.on('click', () => {
      this.windowManager.toggleVisibility();
    });
  }

  public updateMenu(): void {
    if (!this.tray) return;

    const isDnd = this.windowManager.isDndMode();
    const isAutoStart = app.getLoginItemSettings().openAtLogin;
    const activeCount = this.sessionHub.getAllSessions().length;
    const pendingCount = this.sessionHub.getDecisionQueue().length;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `WinVibe 控制台 (${activeCount} 活跃会话, ${pendingCount} 待审批)`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '✅ 快速批准 / 回答通过 (Alt+Y)',
        click: () => {
          this.sessionHub.resolveTargetOrHead('allow');
        },
      },
      {
        label: '❌ 快速拒绝 / 取消拦截 (Alt+N)',
        click: () => {
          this.sessionHub.resolveTargetOrHead('deny');
        },
      },
      {
        label: '✨ 展开 / 呼出灵动岛 (Alt+V)',
        click: () => {
          this.windowManager.toggleVisibility();
        },
      },
      { type: 'separator' },
      {
        label: isDnd ? '🔕 免打扰模式 (已开启)' : '🔔 免打扰模式 (已关闭)',
        type: 'checkbox',
        checked: isDnd,
        click: () => {
          this.windowManager.toggleDnd();
          this.updateMenu();
        },
      },
      {
        label: '🚀 开机自启动',
        type: 'checkbox',
        checked: isAutoStart,
        click: () => {
          app.setLoginItemSettings({
            openAtLogin: !isAutoStart,
          });
          this.updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: '退出 WinVibe',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
