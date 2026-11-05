import { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, type NativeImage, globalShortcut, Notification } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionRegistry } from './sessionRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sessionRegistry = new SessionRegistry();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isHidden = false;
let isDnd = false;
let latestActiveAgents: any[] = [];
const previousAgentStatuses = new Map<string, string>();

interface AuditRecord {
  id: string;
  agent_name: string;
  tool_name: string;
  command: string;
  cwd?: string;
  pid?: number;
  action: 'allow' | 'deny' | 'timeout' | 'ask';
  timestamp: number;
}

const auditFilePath = path.join(os.homedir(), '.winvibe', 'audit_history.json');
let auditHistory: AuditRecord[] = [];
const decisionPayloads = new Map<string, any>();

function loadAuditHistory() {
  try {
    if (fs.existsSync(auditFilePath)) {
      auditHistory = JSON.parse(fs.readFileSync(auditFilePath, 'utf-8'));
    }
  } catch {
    auditHistory = [];
  }
}

function saveAuditRecord(record: AuditRecord) {
  auditHistory.unshift(record);
  if (auditHistory.length > 100) {
    auditHistory = auditHistory.slice(0, 100);
  }
  try {
    fs.writeFileSync(auditFilePath, JSON.stringify(auditHistory, null, 2), 'utf-8');
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audit-history-updated', auditHistory);
  }
}

// 进程级异常防护：阻止端口占用或异步错误弹出系统报错对话框
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.warn(`[WinVibe] 端口占用异常捕获: ${err.message}，正在忽略以保护主进程正常运行。`);
    return;
  }
  console.error('[WinVibe] 异常已捕获:', err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[WinVibe] 未处理的异步拒绝已捕获:', reason);
});

// 单实例锁定：防止重复开启导致端口冲突与弹窗报错
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isHidden) {
      mainWindow.show();
      isHidden = false;
    }
    mainWindow.focus();
  }
});

const HTTP_PORT = 18989;
const AUTH_TOKEN = crypto.randomBytes(24).toString('hex');
const pendingDecisions = new Map<string, { res: http.ServerResponse; timer: NodeJS.Timeout }>();

function ensureConfigDir() {
  const configDir = path.join(os.homedir(), '.winvibe');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  loadAuditHistory();
  const daemonPath = path.join(configDir, 'daemon.json');
  const info = {
    port: HTTP_PORT,
    token: AUTH_TOKEN,
    pid: process.pid,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(daemonPath, JSON.stringify(info, null, 2), 'utf-8');
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    // 基础安全检查：仅允许本机访问
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    // 检查 Token 鉴权
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing token' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/decision/request') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const requestId = payload.request_id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          payload.request_id = requestId;
          payload.command = payload.command || payload.tool_input?.command || payload.toolInput?.command || '未知指令';
          payload.tool_name = payload.tool_name || payload.toolName || 'Bash';
          payload.agent_name = payload.agent_name || 'Claude Code';
          decisionPayloads.set(requestId, payload);

          if (payload.session_id) {
            sessionRegistry.upsert({
              sessionId: payload.session_id,
              agent: payload.agent_name || 'Claude Code',
              pid: payload.pid,
              cwd: payload.cwd,
              status: 'waiting',
              source: 'hook',
              pendingRequestId: requestId,
            });
            console.log(`[WinVibe] SessionRegistry (PreToolUse waiting):`, sessionRegistry.list());
          }

          // 30秒超时自动降级为 'ask' (回退给终端处理)
          const timeoutMs = payload.timeout_ms || 30000;
          const timer = setTimeout(() => {
            if (pendingDecisions.has(requestId)) {
              pendingDecisions.delete(requestId);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ request_id: requestId, action: 'ask', reason: 'timeout' }));
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('decision-timeout', { requestId });
              }
              const info = decisionPayloads.get(requestId) || {};
              saveAuditRecord({
                id: requestId,
                agent_name: info.agent_name || 'Claude Code',
                tool_name: info.tool_name || 'Bash',
                command: info.command || '未知指令',
                cwd: info.cwd,
                pid: info.pid,
                action: 'timeout',
                timestamp: Date.now(),
              });
              decisionPayloads.delete(requestId);
            }
          }, timeoutMs);

          pendingDecisions.set(requestId, { res, timer });

          // 推送给灵动岛前端展示
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('decision-request', payload);
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/session/event') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const sessionId = payload.session_id || payload.sessionId;
          const eventName = payload.event_name || payload.hook_event_name || payload.hookEventName;
          let status: 'running' | 'waiting' | 'completed' | 'unknown' = 'unknown';

          if (eventName === 'UserPromptSubmit') {
            status = 'running';
          } else if (eventName === 'PreToolUse') {
            status = 'waiting';
          } else if (eventName === 'Stop') {
            status = 'completed';
          } else if (payload.status) {
            status = payload.status;
          }

          if (sessionId) {
            sessionRegistry.upsert({
              sessionId,
              agent: payload.agent || payload.agent_name || 'Claude Code',
              pid: payload.pid,
              cwd: payload.cwd,
              status,
              source: 'hook',
              pendingRequestId: payload.request_id,
            });
            console.log(`[WinVibe] SessionRegistry (${eventName} -> ${status}):`, sessionRegistry.list());
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/agent/event') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const event = JSON.parse(body);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent-event', event);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WinVibe] 端口 ${HTTP_PORT} 已被占用（已有运行实例），跳过重复启动。`);
    } else {
      console.error('[WinVibe] HTTP 守护服务异常:', err);
    }
  });

  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`[WinVibe] Daemon listening on http://127.0.0.1:${HTTP_PORT}`);
  });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const WINDOW_WIDTH = 540;
  const WINDOW_HEIGHT = 380;
  const posX = Math.round((screenWidth - WINDOW_WIDTH) / 2);

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: posX,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Windows 灵动岛核心：默认允许鼠标穿透（透明区域不遮挡点击）
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error(`[WinVibe] 页面加载失败: ${code} - ${desc} (${url})`);
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log(`[Web Console] ${message} (${sourceId}:${line})`);
  });

  const isDev = process.argv.includes('--dev');
  const distHtml = path.join(__dirname, '../dist/index.html');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (fs.existsSync(distHtml)) {
        mainWindow?.loadFile(distHtml);
      }
    });
  } else {
    if (fs.existsSync(distHtml)) {
      mainWindow.loadFile(distHtml);
    } else {
      mainWindow.loadURL('http://localhost:5173');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: 动态调整鼠标穿透区域
ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean, forward?: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, { forward: !!forward });
  }
});

function resolveDecision(requestId: string, action: 'allow' | 'deny' | 'ask', selectedOption?: string) {
  const item = pendingDecisions.get(requestId);
  if (item) {
    clearTimeout(item.timer);
    pendingDecisions.delete(requestId);
    item.res.writeHead(200, { 'Content-Type': 'application/json' });
    item.res.end(JSON.stringify({ request_id: requestId, action, selected_option: selectedOption }));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('decision-resolved', { requestId, action, selectedOption });
    }
  }

  // 记录到安全审计历史
  const info = decisionPayloads.get(requestId) || {};
  saveAuditRecord({
    id: requestId,
    agent_name: info.agent_name || 'Claude Code',
    tool_name: info.tool_name || 'Bash',
    command: selectedOption ? `[选择: ${selectedOption}] ${info.command || ''}` : (info.command || '未知指令'),
    cwd: info.cwd,
    pid: info.pid,
    action,
    timestamp: Date.now(),
  });
  decisionPayloads.delete(requestId);
}

// IPC: 审计历史记录获取与清空
ipcMain.handle('get-audit-history', () => {
  return auditHistory;
});

// IPC: 获取当前活跃的 Agent 计划审查文档 (Plan Review)
ipcMain.handle('get-active-plan', () => {
  try {
    const candidatePaths: string[] = [
      path.join(process.cwd(), 'PROJECT_PLAN.md'),
      'D:\\vibe\\agent\\PROJECT_PLAN.md',
    ];

    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
    if (fs.existsSync(brainDir)) {
      const dirs = fs.readdirSync(brainDir)
        .map(d => {
          try {
            const p = path.join(brainDir, d);
            return { dir: p, mtime: fs.statSync(p).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((d): d is { dir: string; mtime: number } => d !== null)
        .sort((a, b) => b.mtime - a.mtime);

      for (const item of dirs.slice(0, 3)) {
        try {
          const files = fs.readdirSync(item.dir);
          const planFile = files.find(f => (f.endsWith('_plan.md') || f === 'PROJECT_PLAN.md') && !f.endsWith('.metadata.json'));
          if (planFile) {
            candidatePaths.unshift(path.join(item.dir, planFile));
          }
        } catch {}
      }
    }

    for (const planPath of candidatePaths) {
      if (fs.existsSync(planPath)) {
        const content = fs.readFileSync(planPath, 'utf-8');
        const lines = content.split('\n');

        const titleLine = lines.find(l => l.startsWith('# '));
        const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(planPath);

        let totalTasks = 0;
        let completedTasks = 0;
        for (const line of lines) {
          if (/-\s*\[x\]/i.test(line)) {
            totalTasks++;
            completedTasks++;
          } else if (/-\s*\[\s*\]/.test(line)) {
            totalTasks++;
          }
        }

        const stats = fs.statSync(planPath);

        return {
          title,
          path: planPath,
          content,
          totalTasks,
          completedTasks,
          lastUpdated: stats.mtimeMs,
        };
      }
    }
  } catch (err: any) {
    console.warn('[WinVibe] 获取计划文件异常:', err.message);
  }
  return null;
});

ipcMain.on('clear-audit-history', () => {
  auditHistory = [];
  try {
    fs.writeFileSync(auditFilePath, '[]', 'utf-8');
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audit-history-updated', []);
  }
});

// IPC: 接收用户在灵动岛点击的决策（允许/拒绝/选中的答案）
ipcMain.on('decision-response', (_, { requestId, action, selectedOption }) => {
  resolveDecision(requestId, action, selectedOption);
});

function getHelperExePath() {
  const packagedPath = path.join(process.resourcesPath, 'scripts', 'WinVibeHelper.exe');
  if (fs.existsSync(packagedPath)) return packagedPath;

  const appPath = path.join(app.getAppPath(), 'scripts', 'WinVibeHelper.exe');
  if (fs.existsSync(appPath)) return appPath;

  const devPath = path.join(__dirname, '../scripts/WinVibeHelper.exe');
  if (fs.existsSync(devPath)) return devPath;

  return 'D:\\vibe\\agent\\scripts\\WinVibeHelper.exe';
}

// IPC: 点击卡片一键聚焦/置前目标终端窗口
ipcMain.on('focus-window', (_, pid: number) => {
  if (!pid) return;
  const helperExe = getHelperExePath();
  execFile(helperExe, ['focus', 'allow', String(pid)], (err, stdout) => {
    if (err) {
      console.warn(`[WinVibe] 唤醒窗口失败 (PID ${pid}):`, err.message);
    } else {
      console.log(`[WinVibe] 唤醒窗口结果 (PID ${pid}):`, stdout.trim());
    }
  });
});

// IPC: 窗口动作
ipcMain.on('window-action', (_, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'close') {
    app.quit();
  } else if (action === 'hide') {
    mainWindow.hide();
  }
});

// 解析单个 Antigravity 会话日志与提问状态
function parseAntigravityTranscript(logFile: string, sessionId: string, pid: number) {
  let status: 'running' | 'waiting' | 'completed' = 'running';
  let message = '会话就绪 / 空闲中...';
  let questionPayload: any = null;

  try {
    const content = fs.readFileSync(logFile, 'utf-8').trim();
    const logLines = content.split('\n');
    if (logLines.length > 0) {
      const last = JSON.parse(logLines[logLines.length - 1]);
      if (last.type === 'USER_INPUT') {
        status = 'running';
        message = '正在思考与处理需求...';
      } else if (last.type === 'PLANNER_RESPONSE') {
        const toolCalls = last.tool_calls || [];
        const lastTool = toolCalls[toolCalls.length - 1];

        if (lastTool && lastTool.name === 'ask_question') {
          status = 'waiting';
          message = '等待用户回答提问...';
          const qData = lastTool.arguments || lastTool.args || {};
          const questions = qData.questions || [];
          if (questions.length > 0) {
            const firstQ = questions[0];
            questionPayload = {
              request_id: `agy-q-${sessionId}-${last.step_index || Date.now()}`,
              session_id: sessionId,
              agent_name: 'Google Antigravity',
              tool_name: 'ask_question',
              type: firstQ.options && firstQ.options.length > 0 ? 'question' : 'complex_question',
              question: firstQ.question,
              summary: firstQ.question,
              options: (firstQ.options || []).map((opt: string, i: number) => ({
                key: String(i + 1),
                label: opt,
                value: opt,
              })),
              pid,
            };
          }
        } else if (lastTool && lastTool.name === 'run_command') {
          status = 'waiting';
          const cmdArgs = lastTool.arguments || lastTool.args || {};
          const cmd = cmdArgs.CommandLine || cmdArgs.command || '命令行指令';
          message = `请求执行: ${cmd}`;
          questionPayload = {
            request_id: `agy-cmd-${sessionId}-${last.step_index || Date.now()}`,
            session_id: sessionId,
            agent_name: 'Google Antigravity',
            tool_name: 'run_command',
            type: 'approval',
            command: cmd,
            question: '权限请求：即将执行系统命令，是否允许？',
            summary: `请求执行: ${cmd}`,
            options: [
              { key: '1', label: '允许执行 (1 / Alt+Y)', value: '1' },
              { key: '2', label: '本次会话始终允许 (2)', value: '2' },
              { key: '4', label: '拒绝取消 (4 / Alt+N)', value: '4' },
            ],
            pid,
          };
        } else {
          status = 'completed';
          message = '已完成当前回答，等待指令';

          const text = (last.content || '').trim();
          if (text && (text.endsWith('?') || text.endsWith('？') || text.includes('？\n') || text.includes('?\n') || /1[\.、]|2[\.、]/.test(text))) {
            const paragraphs = text.split('\n\n').filter(Boolean);
            const lastParagraph = paragraphs[paragraphs.length - 1] || text;
            if (lastParagraph.length < 200 && (lastParagraph.includes('?') || lastParagraph.includes('？') || /1[\.、]/.test(lastParagraph))) {
              status = 'waiting';
              message = lastParagraph.replace(/[#*`]/g, '').trim();
              questionPayload = {
                request_id: `agy-text-q-${sessionId}-${last.step_index || Date.now()}`,
                session_id: sessionId,
                agent_name: 'Google Antigravity',
                tool_name: 'CLI 交互提问',
                type: 'complex_question',
                question: lastParagraph.replace(/[#*`]/g, '').trim(),
                summary: lastParagraph.replace(/[#*`]/g, '').trim(),
                pid,
              };
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[WinVibe] 解析 Antigravity 状态异常:', err.message);
  }

  return { status, message, questionPayload };
}

// 自动化 Agent 感知引擎：多实例感知 + OpenCode / Antigravity / Claude / Cursor 全覆盖
function startAgentWatcher() {
  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  const opencodeDir = path.join(os.homedir(), '.local', 'share', 'opencode');
  const hermesDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes');
  const agentStartTimes = new Map<string, number>();

  let cachedAgyPids = new Set<number>();
  let cachedOpencodePids = new Set<number>();
  let cachedClaudePids = new Set<number>();
  let cachedHermesPids = new Set<number>();

  let isScanningProcesses = false;
  let refreshTimer: NodeJS.Timeout | null = null;

  // 1. 毫秒级状态重新解析与 UI 同步函数（由文件变更或轮询触发）
  function refreshStatuses() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 检索 Antigravity 的全部会话目录
    let sessions: Array<{ id: string; logFile: string; mtime: number }> = [];
    try {
      if (fs.existsSync(brainDir)) {
        sessions = fs.readdirSync(brainDir)
          .map(d => {
            const logFile = path.join(brainDir, d, '.system_generated', 'logs', 'transcript.jsonl');
            try {
              if (fs.existsSync(logFile)) {
                return { id: d, logFile, mtime: fs.statSync(logFile).mtimeMs };
              }
            } catch {}
            return null;
          })
          .filter((s): s is { id: string; logFile: string; mtime: number } => s !== null)
          .sort((a, b) => b.mtime - a.mtime);
      }
    } catch {}

    // 解析 OpenCode 状态
    let opencodeStatus: 'running' | 'waiting' | 'completed' | 'error' = 'completed';
    let opencodeMessage = '会话就绪 / 空闲中...';

    try {
      const opencodeLog = path.join(opencodeDir, 'log', 'opencode.log');
      if (fs.existsSync(opencodeLog)) {
        const stats = fs.statSync(opencodeLog);
        const isRecent = (Date.now() - stats.mtimeMs) < 25000;
        const fd = fs.openSync(opencodeLog, 'r');
        const bufferSize = Math.min(stats.size, 4096);
        const buffer = Buffer.alloc(bufferSize);
        fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
        fs.closeSync(fd);
        const logContent = buffer.toString('utf-8');

        if (isRecent) {
          if (/message="stream"|message=stream/i.test(logContent)) {
            opencodeStatus = 'running';
            opencodeMessage = '正在进行流式代码生成与推理...';
          } else if (/message="stream error"|AI_APICallError/i.test(logContent)) {
            opencodeStatus = 'error';
            opencodeMessage = '模型推理连接失败，正在重试...';
          } else if (/creating instance|bootstrapping/i.test(logContent)) {
            opencodeStatus = 'running';
            opencodeMessage = '正在初始化工作区环境...';
          } else {
            opencodeStatus = 'completed';
            opencodeMessage = '任务已完成，等待下一条指令';
          }
        } else {
          opencodeStatus = 'completed';
          opencodeMessage = '会话就绪，等待输入任务';
        }
      }
    } catch {}

    // 解析 Hermes Agent 状态
    let hermesStatus: 'running' | 'waiting' | 'completed' | 'error' = 'completed';
    let hermesMessage = 'Hermes 终端会话就绪...';

    try {
      const hermesLog = path.join(hermesDir, 'logs', 'agent.log');
      if (fs.existsSync(hermesLog)) {
        const stats = fs.statSync(hermesLog);
        const isRecent = (Date.now() - stats.mtimeMs) < 25000;
        const fd = fs.openSync(hermesLog, 'r');
        const bufferSize = Math.min(stats.size, 4096);
        const buffer = Buffer.alloc(bufferSize);
        fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
        fs.closeSync(fd);
        const logContent = buffer.toString('utf-8');

        if (isRecent) {
          if (/Streaming|chat_completion_stream_request/i.test(logContent)) {
            hermesStatus = 'running';
            hermesMessage = '正在进行深度推理与思考...';
          } else if (/API call failed|Connection error/i.test(logContent)) {
            hermesStatus = 'error';
            hermesMessage = 'API 请求异常，正在重试...';
          } else if (/tool_call|executing tool/i.test(logContent)) {
            hermesStatus = 'running';
            hermesMessage = '正在执行工具命令调用...';
          } else {
            hermesStatus = 'completed';
            hermesMessage = '生成完毕，等待下一轮指令';
          }
        } else {
          hermesStatus = 'completed';
          hermesMessage = '会话就绪，等待任务指令';
        }
      }
    } catch {}

    const activeList: any[] = [];
    const agyArray = Array.from(cachedAgyPids);
    const opencodeArray = Array.from(cachedOpencodePids);
    const claudeArray = Array.from(cachedClaudePids);
    const hermesArray = Array.from(cachedHermesPids);
    const agyQuestionsToPush: any[] = [];

    // 1. 挂载所有运行中的 Antigravity 实例（多实例精准会话隔离）
    agyArray.forEach((pid, idx) => {
      const id = `agy-${pid}`;
      if (!agentStartTimes.has(id)) agentStartTimes.set(id, Date.now());

      // 为每个多开实例映射各自最近的会话，杜绝多实例串台
      const session = sessions[idx] || sessions[0];
      let instanceStatus: 'running' | 'waiting' | 'completed' = 'running';
      let instanceMessage = '会话就绪 / 空闲中...';

      if (session) {
        const parsed = parseAntigravityTranscript(session.logFile, session.id, pid);
        instanceStatus = parsed.status;
        instanceMessage = parsed.message;
        if (parsed.questionPayload) {
          agyQuestionsToPush.push(parsed.questionPayload);
        }
      }

      activeList.push({
        id,
        name: agyArray.length > 1 ? `Google Antigravity (#${idx + 1})` : 'Google Antigravity',
        status: instanceStatus,
        lastMessage: instanceMessage,
        pid,
        startTime: agentStartTimes.get(id) || Date.now(),
      });
    });

    // 2. 挂载所有运行中的 OpenCode 实例
    opencodeArray.forEach((pid, idx) => {
      const id = `opencode-${pid}`;
      if (!agentStartTimes.has(id)) agentStartTimes.set(id, Date.now());
      activeList.push({
        id,
        name: opencodeArray.length > 1 ? `OpenCode (#${idx + 1})` : 'OpenCode',
        status: opencodeStatus,
        lastMessage: opencodeMessage,
        pid,
        startTime: agentStartTimes.get(id) || Date.now(),
      });
    });

    // 3. 挂载所有运行中的 Claude Code 实例（实时感知待审批决策状态）
    claudeArray.forEach((pid, idx) => {
      const id = `claude-${pid}`;
      if (!agentStartTimes.has(id)) agentStartTimes.set(id, Date.now());

      // 检查 Claude 是否有挂起的审批决策
      const pendingForThis = Array.from(decisionPayloads.values()).find(
        d => d.agent_name === 'Claude Code' && (d.pid === pid || !d.pid)
      );

      const status = pendingForThis ? 'waiting' : 'running';
      const lastMessage = pendingForThis
        ? `待审批: ${pendingForThis.command || '高危命令'}`
        : 'CLI 处于活动监听状态...';

      activeList.push({
        id,
        name: claudeArray.length > 1 ? `Claude Code (#${idx + 1})` : 'Claude Code',
        status,
        lastMessage,
        pid,
        startTime: agentStartTimes.get(id) || Date.now(),
      });
    });

    // 4. 挂载所有运行中的 Hermes 实例
    hermesArray.forEach((pid, idx) => {
      const id = `hermes-${pid}`;
      if (!agentStartTimes.has(id)) agentStartTimes.set(id, Date.now());
      activeList.push({
        id,
        name: hermesArray.length > 1 ? `Hermes Agent (#${idx + 1})` : 'Hermes Agent',
        status: hermesStatus,
        lastMessage: hermesMessage,
        pid,
        startTime: agentStartTimes.get(id) || Date.now(),
      });
    });

    // 任务完成检测与 Windows 原生桌面通知
    activeList.forEach((agent) => {
      const prevStatus = previousAgentStatuses.get(agent.id);
      if (prevStatus === 'running' && agent.status === 'completed') {
        console.log(`[WinVibe] 任务完成，触发桌面通知: ${agent.name}`);
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: `🎉 ${agent.name} 任务已完成`,
            body: agent.lastMessage || 'AI Agent 已完成当前执行阶段，等待您审查或输入下一条指令。',
            silent: false,
          });
          notification.on('click', () => {
            if (agent.pid) {
              const helperExe = getHelperExePath();
              execFile(helperExe, ['focus', 'allow', String(agent.pid)]);
            }
          });
          notification.show();
        }
      }
      previousAgentStatuses.set(agent.id, agent.status);
    });

    latestActiveAgents = activeList;

    // 实时感知到 Antigravity 提问且当前没有展示时，自动推送给灵动岛
    agyQuestionsToPush.forEach((qPayload) => {
      if (!pendingDecisions.has(qPayload.request_id)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('decision-request', qPayload);
        }
      }
    });

    // 如果当前没有任何 Antigravity 实例处于 waiting 状态，通知前端消除旧提问卡片
    const hasAnyAgyWaiting = activeList.some(a => a.id.startsWith('agy-') && a.status === 'waiting');
    if (!hasAnyAgyWaiting && agyQuestionsToPush.length === 0) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('decision-resolved', { requestId: 'agy-all', action: 'dismiss' });
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('active-agents-sync', activeList);
    }
  }

  // 防抖调度器：避免文件高频写入导致重复解析
  function triggerFastRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshStatuses();
    }, 60);
  }

  // 2. 进程发现扫描（周期拉长至 5000ms，大幅降低系统开销）
  function scanProcesses() {
    if (isScanningProcesses) return;
    isScanningProcesses = true;

    execFile('tasklist', ['/fo', 'csv', '/nh'], (err, stdout) => {
      isScanningProcesses = false;
      if (err || !stdout) return;

      const lines = stdout.split('\r\n');
      const nextAgyPids = new Set<number>();
      const nextOpencodePids = new Set<number>();
      const nextClaudePids = new Set<number>();
      const nextHermesPids = new Set<number>();

      for (const line of lines) {
        if (/^"(agy|Antigravity)\.exe"/i.test(line)) {
          const match = line.match(/^"[^"]+","(\d+)"/);
          if (match) nextAgyPids.add(parseInt(match[1], 10));
        } else if (/^"opencode\.exe"/i.test(line)) {
          const match = line.match(/^"[^"]+","(\d+)"/);
          if (match) nextOpencodePids.add(parseInt(match[1], 10));
        } else if (/^"(claude|claude-code)\.exe"/i.test(line)) {
          const match = line.match(/^"[^"]+","(\d+)"/);
          if (match) nextClaudePids.add(parseInt(match[1], 10));
        } else if (/^"(hermes|hermes-agent|hermes-acp)\.exe"/i.test(line)) {
          const match = line.match(/^"[^"]+","(\d+)"/);
          if (match) nextHermesPids.add(parseInt(match[1], 10));
        }
      }

      cachedAgyPids = nextAgyPids;
      cachedOpencodePids = nextOpencodePids;
      cachedClaudePids = nextClaudePids;
      cachedHermesPids = nextHermesPids;

      refreshStatuses();
    });
  }

  // 3. 事件驱动文件监控 (毫秒级即时响应)
  try {
    if (fs.existsSync(brainDir)) {
      const watcher = fs.watch(brainDir, { recursive: true }, (_, filename) => {
        if (filename && (filename.endsWith('transcript.jsonl') || filename.includes('transcript'))) {
          triggerFastRefresh();
        }
      });
      watcher.on('error', () => {});
    }
  } catch {}

  try {
    const opencodeLogDir = path.join(opencodeDir, 'log');
    if (fs.existsSync(opencodeLogDir)) {
      const watcher = fs.watch(opencodeLogDir, () => triggerFastRefresh());
      watcher.on('error', () => {});
    }
  } catch {}

  try {
    const hermesLogDir = path.join(hermesDir, 'logs');
    if (fs.existsSync(hermesLogDir)) {
      const watcher = fs.watch(hermesLogDir, () => triggerFastRefresh());
      watcher.on('error', () => {});
    }
  } catch {}

  // 首次立即扫描一次进程并解析状态
  scanProcesses();

  // 5000ms 周期性做进程生死保底检测（相比 2000ms 减少 60% 系统调用消耗）
  setInterval(() => {
    scanProcesses();
  }, 5000);
}

function toggleIslandVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isHidden) {
    mainWindow.show();
    isHidden = false;
  } else {
    mainWindow.hide();
    isHidden = true;
  }
}

function triggerExpandOrShow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isHidden) {
    mainWindow.show();
    isHidden = false;
  } else {
    mainWindow.webContents.send('toggle-expand');
  }
}

// 防抖锁，避免连续多次按键造成终端抖动
let isShortcutBusy = false;

function handleApproveOrConfirm(action: 'allow' | 'deny') {
  if (isShortcutBusy) return;
  isShortcutBusy = true;
  setTimeout(() => { isShortcutBusy = false; }, 350);

  console.log(`[WinVibe] handleApproveOrConfirm: action=${action}`);

  // 1. 优先处理挂起的高危命令决策请求 (来自 Claude Code Hook / API)
  const keys = Array.from(pendingDecisions.keys());
  if (keys.length > 0) {
    const targetId = keys[0];
    resolveDecision(targetId, action);
    console.log(`[WinVibe] Resolved pending HTTP decision ${targetId} with ${action}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut-decision', action);
    }
    return;
  }

  // 2. 广播给前端同步消除界面卡片（如模拟审批或队列中卡片）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut-decision', action);
  }

  // 3. 处理 cmd 终端里面的会话暂停提问与交互确认（严防盲按误触守卫）
  const waitingAgent = latestActiveAgents.find(a => a.status === 'waiting');
  if (!waitingAgent) {
    console.log('[WinVibe] 安全守卫已生效：当前没有处于 waiting 状态的 Agent 会话，拒绝盲发键盘按键以保护终端。');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-quick-feedback', {
        action: 'deny',
        agentName: '所有会话',
        key: '无待确认任务',
        message: '当前无等待确认的会话'
      });
    }
    return;
  }

  const targetPid = waitingAgent.pid || 0;
  const agentName = waitingAgent.name || '活动终端';
  const helperExe = getHelperExePath();

  console.log(`[WinVibe] 调用 WinVibeHelper 发送快捷响应 ${action} 到 PID ${targetPid} (${agentName})`);
  execFile(helperExe, ['send-key', action, String(targetPid)], (err, stdout) => {
    if (err) {
      console.warn('[WinVibe] WinVibeHelper 执行失败:', err.message);
    } else {
      console.log(`[WinVibe] WinVibeHelper 响应:`, stdout?.trim());
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-quick-feedback', {
          action,
          agentName,
          key: action === 'allow' ? 'Y' : 'N'
        });
      }
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  let icon: NativeImage;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('WinVibe - AI Agent 灵动岛控制台');

  const updateMenu = () => {
    const isAutoLaunch = app.getLoginItemSettings().openAtLogin;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: isHidden ? '显示灵动岛' : '隐藏灵动岛',
        click: () => {
          toggleIslandVisibility();
          updateMenu();
        },
      },
      {
        label: isDnd ? '关闭免打扰' : '开启免打扰 (DND)',
        type: 'checkbox',
        checked: isDnd,
        click: () => {
          isDnd = !isDnd;
          updateMenu();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('dnd-toggle', isDnd);
          }
        },
      },
      { type: 'separator' },
      {
        label: '✅ 快速批准 / 回答通过 (Ctrl+Alt+Y / Alt+Y)',
        click: () => {
          handleApproveOrConfirm('allow');
        },
      },
      {
        label: '❌ 快速拒绝 / 取消拦截 (Ctrl+Alt+N / Alt+N)',
        click: () => {
          handleApproveOrConfirm('deny');
        },
      },
      {
        label: '✨ 展开 / 呼出灵动岛 (Alt+V)',
        click: () => {
          triggerExpandOrShow();
        },
      },
      { type: 'separator' },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: isAutoLaunch,
        click: (item) => {
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            path: process.execPath,
          });
        },
      },
      {
        label: '重启灵动岛',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
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
    tray?.setContextMenu(contextMenu);
  };

  tray.on('double-click', () => {
    toggleIslandVisibility();
    updateMenu();
  });

  updateMenu();
}

function registerGlobalShortcuts() {
  const allowFn = () => handleApproveOrConfirm('allow');
  const denyFn = () => handleApproveOrConfirm('deny');

  // 支持经典 Alt+Y 以及免冲突的 Ctrl+Alt+Y / Alt+1
  globalShortcut.register('Alt+Y', allowFn);
  globalShortcut.register('Ctrl+Alt+Y', allowFn);
  globalShortcut.register('Alt+1', allowFn);

  // 支持经典 Alt+N 以及免冲突的 Ctrl+Alt+N / Alt+4
  globalShortcut.register('Alt+N', denyFn);
  globalShortcut.register('Ctrl+Alt+N', denyFn);
  globalShortcut.register('Alt+4', denyFn);

  globalShortcut.register('Alt+Shift+V', triggerExpandOrShow);
  globalShortcut.register('Alt+V', triggerExpandOrShow);
}

app.whenReady().then(() => {
  ensureConfigDir();
  startHttpServer();
  createWindow();
  startAgentWatcher();
  createTray();
  registerGlobalShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
