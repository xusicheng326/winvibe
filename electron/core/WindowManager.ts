import { BrowserWindow, screen, Notification, app } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Win32Bridge } from './Win32Bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WindowManager {
  private window: BrowserWindow | null = null;
  private isHidden: boolean = false;
  private isDnd: boolean = false;
  private isExpanded: boolean = false;

  private static readonly COLLAPSED_WIDTH = 340;
  private static readonly COLLAPSED_HEIGHT = 56;
  private static readonly EXPANDED_WIDTH = 720;
  private static readonly EXPANDED_HEIGHT = 620;

  public createWindow(isDev: boolean): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    // 默认启动为紧凑胶囊尺寸，绝不大面积遮挡桌面与浏览器
    const windowWidth = WindowManager.COLLAPSED_WIDTH;
    const windowHeight = WindowManager.COLLAPSED_HEIGHT;
    const windowX = Math.round((screenWidth - windowWidth) / 2);
    const windowY = 0;

    const preloadPath = path.join(__dirname, '../preload.cjs');

    this.window = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, 'screen-saver');

    // 胶囊态窗口紧凑且自身即可精准捕获点击，无需全局穿透转发
    this.window.setIgnoreMouseEvents(false);

    // 工业级交互：失焦自动收起（点击其他应用或桌面立即收拢，绝不阻挡操作）
    this.window.on('blur', () => {
      if (this.isExpanded) {
        this.setWindowExpanded(false);
        this.sendToRenderer('auto-collapse');
      }
    });

    if (isDev) {
      this.window.loadURL('http://localhost:5173');
    } else {
      this.window.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    return this.window;
  }

  public setWindowExpanded(expanded: boolean) {
    if (!this.window || this.window.isDestroyed()) return;
    this.isExpanded = expanded;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    if (expanded) {
      const windowWidth = WindowManager.EXPANDED_WIDTH;
      const windowHeight = WindowManager.EXPANDED_HEIGHT;
      const windowX = Math.round((screenWidth - windowWidth) / 2);
      this.window.setBounds({ x: windowX, y: 0, width: windowWidth, height: windowHeight });
      this.window.setIgnoreMouseEvents(false);
      this.window.focus();
    } else {
      const windowWidth = WindowManager.COLLAPSED_WIDTH;
      const windowHeight = WindowManager.COLLAPSED_HEIGHT;
      const windowX = Math.round((screenWidth - windowWidth) / 2);
      this.window.setBounds({ x: windowX, y: 0, width: windowWidth, height: windowHeight });
      this.window.setIgnoreMouseEvents(false);
    }
  }

  public getWindow(): BrowserWindow | null {
    return this.window;
  }

  public forceForeground(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    // 通过底层 Win32 API 彻底破除 Windows 前台焦点保护，确保首个按键 100% 瞬时命中
    Win32Bridge.focusWindow(process.pid, 'WinVibe', '');
  }

  public setIgnoreMouseEvents(ignore: boolean, forward: boolean = true) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setIgnoreMouseEvents(ignore, { forward });
    }
  }

  public toggleVisibility(): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    if (this.isHidden) {
      this.window.show();
      this.window.focus();
      this.isHidden = false;
    } else {
      this.window.hide();
      this.isHidden = true;
    }
    return !this.isHidden;
  }

  public toggleDnd(): boolean {
    this.isDnd = !this.isDnd;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dnd-toggle', this.isDnd);
    }
    return this.isDnd;
  }

  public isDndMode(): boolean {
    return this.isDnd;
  }

  public showTaskNotification(title: string, body: string, pid?: number) {
    if (this.isDnd) return;
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title,
      body,
      silent: false,
    });

    if (pid && pid > 0) {
      notification.on('click', () => {
        Win32Bridge.focusWindow(pid);
      });
    }

    notification.show();
  }

  public sendToRenderer(channel: string, ...args: any[]) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }
}
