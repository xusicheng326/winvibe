import { app, ipcMain } from 'electron';
import { WindowManager } from './core/WindowManager.js';
import { SessionHub } from './core/SessionHub.js';
import { HttpDaemon } from './core/HttpDaemon.js';
import { TrayManager } from './core/TrayManager.js';
import { ShortcutManager } from './core/ShortcutManager.js';
import { ProcessWatcher } from './core/ProcessWatcher.js';
import { Win32Bridge } from './core/Win32Bridge.js';
import { AuditService } from './services/AuditService.js';
import { TelemetryService } from './services/TelemetryService.js';
import { PlanService } from './services/PlanService.js';
import { AntigravityAdapter } from './adapters/AntigravityAdapter.js';
import { OpenCodeAdapter } from './adapters/OpenCodeAdapter.js';
import { HermesAdapter } from './adapters/HermesAdapter.js';
import { CursorAdapter } from './adapters/CursorAdapter.js';

// 单实例运行保护
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// 核心服务实例
const windowManager = new WindowManager();
const sessionHub = new SessionHub();
const auditService = new AuditService();
const telemetryService = new TelemetryService();
const httpDaemon = new HttpDaemon(sessionHub, auditService, telemetryService);
const trayManager = new TrayManager(windowManager, sessionHub);
const shortcutManager = new ShortcutManager(windowManager, sessionHub);
const processWatcher = new ProcessWatcher(sessionHub);

// 适配器
const agyAdapter = new AntigravityAdapter(sessionHub, telemetryService);
const opencodeAdapter = new OpenCodeAdapter(sessionHub);
const hermesAdapter = new HermesAdapter(sessionHub);
const cursorAdapter = new CursorAdapter(sessionHub);

const previousStatuses = new Map<string, string>();

app.whenReady().then(async () => {
  const isDev = process.argv.includes('--dev');
  windowManager.createWindow(isDev);
  trayManager.init();
  shortcutManager.register();

  // 启动本地 HTTP 守护服务 (18989 端口)
  await httpDaemon.start();

  // 启动各 Agent 适配器与轻量进程感知
  await agyAdapter.init();
  await opencodeAdapter.init();
  await hermesAdapter.init();
  await cursorAdapter.init();
  processWatcher.start();

  // 会话与队列双向同步回调
  sessionHub.setCallbacks(
    (sessions) => {
      windowManager.sendToRenderer('active-agents-sync', sessions);
      trayManager.updateMenu();

      // 任务完成 Windows 原生通知
      for (const s of sessions) {
        const prev = previousStatuses.get(s.id);
        if (prev === 'running' && s.status === 'completed') {
          windowManager.showTaskNotification(
            `🎉 ${s.name} 任务已完成`,
            s.lastMessage || 'AI Agent 已完成当前执行阶段，等待您审查或输入下一步指令。',
            s.pid
          );
        }
        previousStatuses.set(s.id, s.status);
      }
    },
    (decisions) => {
      trayManager.updateMenu();
      if (decisions.length > 0) {
        windowManager.forceForeground();
        windowManager.sendToRenderer('decision-request', decisions[0]);
      } else {
        windowManager.sendToRenderer('decision-resolved', { requestId: 'all', action: 'dismiss' });
      }
    }
  );

  // 审计记录变更同步
  auditService.setOnUpdate((history) => {
    windowManager.sendToRenderer('audit-history-updated', history);
  });

  // 遥测数据变更同步
  telemetryService.setOnUpdate((telemetry) => {
    windowManager.sendToRenderer('telemetry-updated', telemetry);
  });

  setupIpcHandlers();
});

function setupIpcHandlers() {
  ipcMain.on('set-ignore-mouse-events', (_, ignore: boolean, forward?: boolean) => {
    windowManager.setIgnoreMouseEvents(ignore, forward);
  });

  ipcMain.on('set-window-expanded', (_, expanded: boolean) => {
    windowManager.setWindowExpanded(expanded);
  });

  ipcMain.on('decision-response', (_, data: { requestId: string; action: 'allow' | 'deny' | 'ask'; selectedOption?: string }) => {
    sessionHub.resolveDecision(data.requestId, data.action, data.selectedOption);
  });

  ipcMain.on('focus-window', (_, pid?: number, nameHint?: string, cwdHint?: string) => {
    Win32Bridge.focusWindow(pid, nameHint, cwdHint);
  });

  ipcMain.on('abort-session', (_, data: { sessionId: string; pid?: number }) => {
    if (data.pid && data.pid > 0) {
      Win32Bridge.abortProcess(data.pid);
    }
    sessionHub.upsertSession({
      id: data.sessionId,
      status: 'error',
      lastMessage: '用户已紧急中止任务',
    });
  });

  ipcMain.on('window-action', (_, action: string) => {
    if (action === 'close') {
      app.quit();
    } else if (action === 'hide') {
      windowManager.toggleVisibility();
    }
  });

  ipcMain.on('set-target-session', (_, sessionId: string | null) => {
    sessionHub.setTargetSession(sessionId);
  });

  ipcMain.handle('get-audit-history', () => {
    return auditService.getHistory();
  });

  ipcMain.on('clear-audit-history', () => {
    auditService.clearHistory();
  });

  ipcMain.handle('get-active-plan', () => {
    return PlanService.getActivePlan();
  });

  ipcMain.handle('get-telemetry', () => {
    return telemetryService.getGlobalTelemetry(sessionHub.getAllSessions().length);
  });
}

app.on('second-instance', () => {
  const win = windowManager.getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  shortcutManager.unregister();
  trayManager.destroy();
  processWatcher.stop();
  await agyAdapter.destroy();
  await opencodeAdapter.destroy();
  await hermesAdapter.destroy();
  await cursorAdapter.destroy();
  await httpDaemon.stop();
});
