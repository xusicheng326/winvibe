# WinVibe (Windows AI Agent 灵动岛控制台)

> **项目目标**：在 Windows 平台上实现 AI Agent 灵动岛控制台，主打 **Claude Code 审批决策闭环** 与 **多 Agent 状态实时监控**。
> **项目根目录**：`D:\vibe\agent`
> **设计原则**：以《WinVibe 方案评审》为基准，采取**垂直切片先行（优先攻克 Hook 决策闭环与点击穿透硬技术点）**的开发策略。

---

## 一、系统架构与技术选型

### 1.1 架构方案
鉴于本机已安装 Node.js 24 / npm 11，且无需预装数 GB 的 MSVC C++ 构建工具链，核心架构采用：
- **宿主层**：**Electron + Vite + TypeScript**
  - 原生无边框透明窗口（`transparent: true, frame: false`）
  - 动态点击穿透（`setIgnoreMouseEvents`）：**收起时仅胶囊区域接收鼠标，透明区域完全穿透，不遮挡下方浏览器/IDE点击**；展开时恢复事件捕获。
  - 始终置顶（`alwaysOnTop: 'screen-saver'`）与排除任务栏（`skipTaskbar: true`）。
- **前端层**：**React 19 + TailwindCSS + Framer Motion**
  - 物理弹簧弹性伸缩动画，毛玻璃 Fluent 设计。
  - 前端 UI 代码保持无环境耦合，后续如需迁移 Tauri v2 可 100% 复用。
- **本地安全中枢 (Agent Event Hub)**：
  - Node.js 内置 HTTP Server 监听 `127.0.0.1:18989`（支持端口冲突自动回退）。
  - **安全模型**：启动时生成高强度随机 Token，保存在用户目录 `~/.winvibe/auth.token`；所有 Hook 请求必须携带 `Authorization: Bearer <token>`，严格校验 `Origin/Host`，杜绝网页钓鱼。
- **Hook 闭环机制 (Claude Code 适配)**：
  - 提供轻量命令行工具 `vibe-hook`（作为 Claude Code 的 `PreToolUse` hook）。
  - Hook 发起阻塞 HTTP 请求等待用户在灵动岛点击【允许 / 拒绝】。
  - **超时与兜底**：30秒未响应或灵动岛未启动时，**快速降级返回终端原生提示**，严禁卡死或默认盲批。

---

## 二、通信协议设计 (v2 API Spec)

### 2.1 鉴权与发现
- 状态文件：`%USERPROFILE%\.winvibe\daemon.json`
```json
{
  "port": 18989,
  "token": "e8a9f3b2...",
  "pid": 4321
}
```

### 2.2 决策审批流 (Decision Hook)
- **POST `/api/v1/decision/request`** (由 `vibe-hook` 阻塞调用)
```json
{
  "request_id": "req-1729864000-abc",
  "agent_name": "Claude Code",
  "tool_name": "Bash",
  "command": "npm run build",
  "cwd": "D:\\projects\\demo",
  "timeout_ms": 30000,
  "pid": 12890
}
```
- **POST `/api/v1/decision/response`** (由灵动岛 UI 提交决策)
```json
{
  "request_id": "req-1729864000-abc",
  "action": "allow" // "allow" | "deny" | "ask"
}
```
- Hook 脚本收到决策后输出 JSON 给 Claude Code，或超时返回 `ask` 让终端接管。

### 2.3 状态通知流 (Notification)
- **POST `/api/v1/agent/event`**：用于非阻塞通知（如任务开始、进度上报、任务完成、心跳）。

---

## 三、迭代任务清单与执行状态 (Checklists)

### 🚀 Spike 1: 基础工程与透明穿透窗口验证
- [x] 初始化 Vite + React + TypeScript + Tailwind + Electron 项目骨架 (`D:\vibe\agent`)
- [x] 实现屏幕顶部居中无边框、置顶、不在任务栏显示的灵动岛窗口
- [x] 验证**动态鼠标穿透**（鼠标离开胶囊时背景完全穿透，不阻挡下方应用点击）

### 🚀 Spike 2: Claude Code Hook 决策闭环（最小垂直切片）
- [x] 搭建带 Token 鉴权的本地 HTTP 守护服务（监听 `127.0.0.1:18989`）
- [x] 编写轻量 Hook 客户端脚本（阻塞请求 + 30秒超时自动降级：`scripts/vibe-hook.js`）
- [x] 验证端到端：终端触发请求 -> 灵动岛弹窗 -> 点击允许/拒绝 -> 终端正确继续/中止

### 🎨 Milestone 3: 灵动岛 UI 动效与多状态看板
- [x] Framer Motion 物理弹性伸缩动画（胶囊态 ↔ 审批态 ↔ 展开态）
- [x] 危险命令完整查看与防伪装安全展示（完整代码、工作路径、拒绝/允许操作）
- [x] 多 Agent 并发任务队列与优先级排队（支持多审批队列 `1/N` 计数与平滑出队）
- [x] 多实例同名 Agent 自动区分感知（如多开终端：`Google Antigravity (#1)`、`Google Antigravity (#2)` 并行展示）
- [x] 进程生命周期动态同步（自动清理已退出的终端实例，数字实时增减）

### ⚡ Milestone 4: Windows 终端窗口精准聚焦 (Jump-Back)
- [x] 编写 Win32 进程树溯源与窗口唤醒脚本 (`scripts/focus-window.ps1`)
- [x] 突破前台锁定限制（`SW_RESTORE` + `SetForegroundWindow`），点击卡片/PID直达终端窗口

### 🔔 Milestone 5: 系统托盘与全局快捷键 (System Tray & Global Hotkeys)
- [x] 系统托盘驻留 (`Tray`) 与指示图标 (`dist-electron/tray-icon.png`)
- [x] 托盘菜单可交互动作项：
  - `✅ 快速批准 / 回答通过 (Alt+Y)`：可点击执行，非置灰纯展示
  - `❌ 快速拒绝 / 取消拦截 (Alt+N)`：可点击执行
  - `✨ 展开 / 呼出灵动岛 (Alt+V)`：可点击执行
  - 免打扰模式 (DND)、开机自启配置 (`openAtLogin`)、重载灵动岛、彻底退出
- [x] 全局快捷键与终端会话双模联动 (`globalShortcut`)：
  - `Alt+Y` / `Alt+N`：优先处理悬浮卡片；若无卡片，调用专用高性能原生助手 [`scripts/WinVibeHelper.exe`](file:///D:/vibe/agent/scripts/WinVibeHelper.exe)（毫秒级执行，告别 powershell 启动延迟）：
    - 智能判定前台焦点：若当前正处于 cmd / powershell / terminal 窗口，直接就地注入 `y` + 回车；
    - 若不在终端前台：自动穿透进程树追溯宿主窗口，突破 Windows 前台激活锁并进行控制台输入直写 (`WriteConsoleInput`) 与键盘仿真 (`keybd_event`)。
  - `Alt+V` / `Alt+Shift+V`：单手展开 / 收起灵动岛面板
  - 灵动岛微触感实时回显（`agent-quick-feedback` 动态胶囊通知）

### 📦 Milestone 6: 生产打包与高级特性
- [x] 提供自动配置 Claude Code `settings.json` hook 的一键安装脚本 (`scripts/install-claude-hook.js`)
- [x] 打包为轻量 Windows 独立运行程序 (`.exe` 便携绿色单文件：`D:\vibe\agent\WinVibe.exe` 与 `release\WinVibe 0.1.0.exe`)
- [x] 单实例互斥锁与端口冲突防护 (`app.requestSingleInstanceLock()` + `server.on('error')` + `process.on('uncaughtException')` 自动静默保护)

### 🧠 Milestone 7: OpenCode 与 Hermes Agent 状态深度解析 (Deep Status Parsing)
- [x] **OpenCode 深度状态解析**：解析 `~/.local/share/opencode/log/opencode.log` 运行日志末尾特征：
  - 实时识别 `stream generating` 流式生成状态、`instance bootstrapping` 初始化、`error` 异常报错、`waiting` 状态。
- [x] **Hermes Agent 深度状态解析**：解析 `%LOCALAPPDATA%\hermes\logs\agent.log` 运行日志末尾特征：
  - 实时识别 `executing tool` 工具调用、`streaming` 推理生成、API 异常等精细状态。

### 🔔 Milestone 8: Windows 原生 Toast 吐司通知 (Native Notifications)
- [x] Agent 状态转为 `completed`（任务完成）时触发 Windows 系统原生通知。
- [x] 点击系统 Toast 通知直接调用 `scripts/focus-window.ps1` 一键唤醒并聚焦对应终端窗口。

### 🛡️ Milestone 9: 安全决策历史审计仪表盘 (Audit Log & Tab UI)
- [x] 审计数据本地安全持久化（存储于 `%USERPROFILE%\.winvibe\audit_history.json`，保留最近 100 条）。
- [x] 灵动岛展开看板双标签支持：**【活跃会话】** 与 **【安全审计】** 一键切换。
- [x] 详细审计信息展示（时间戳、Agent 来源、工具类型、PID、执行的完整命令行、允许/拦截/超时标签）。
- [x] 审计记录一键清空与实时双向同步。

---

## 四、常见问题与踩坑指南 (Troubleshooting)

### Q1: 启动报 `electron: --use-env-proxy is not allowed in NODE_OPTIONS`
- **原因**：系统全局环境变量中配置了 `NODE_OPTIONS=--use-env-proxy`。Electron 内部禁止在 `NODE_OPTIONS` 中传递该参数以防止安全隐患。
- **解决方案**：
  - 项目已内置安全环境启动器 [`scripts/launch.js`](file:///D:/vibe/agent/scripts/launch.js)，会自动清理冲突项；
  - 直接运行 [`start.bat`](file:///D:/vibe/agent/start.bat) 或 `npm start` 即可。

### Q2: 报 `Error: listen EADDRINUSE: address already in use 127.0.0.1:18989`
- **原因**：后台已有正在运行的 WinVibe 实例占用了 18989 守护端口，再次双击启动触发端口冲突。
- **解决方案**：
  - 已在主进程注入 `app.requestSingleInstanceLock()` 单实例机制与 `server.on('error')` 端口容错；
  - 若检测到已有实例运行，后启动的程序将自动聚焦/唤醒现有灵动岛并静默退出，彻底避免弹窗报错。

### Q3: 报 `agent executor error: proto: field ... contains invalid UTF-8`
- **原因**：中文版 Windows `cmd.exe` 默认输出编码为 **GBK (CP936)**。当 Antigravity 调用 Hook 命令时，若命令产生 GBK 中文错误输出，会被 Antigravity 写入内部 Protobuf 结构，而 Protobuf 强制要求合法 UTF-8，导致底层断言崩溃。
- **解决方案**：
  - 避免在 `hooks.json` 中配置易受 cmd 编码污染的复杂脚本；
  - 推荐采用进程级包装器 [`scripts/vibe-run.js`](file:///D:/vibe/agent/scripts/vibe-run.js) 启动 Antigravity / Hermes / OpenCode，100% 隔离编码冲突且稳定可靠。

### Q4: 灵动岛始终显示 0，后台即使运行了 Antigravity 也不感知
- **根因 1（IPC 桥接阻断）**：Electron 预加载脚本被编译为了 ESM 格式，触发 `SyntaxError: Cannot use import statement outside a module`，导致 `window.winvibe` 为 undefined，前端完全无法接收任何事件。
  - **解决**：改用 CommonJS 原生规格的 [`preload.cjs`](file:///D:/vibe/agent/electron/preload.cjs)，确保无损注入 `window.winvibe`。
- **根因 2（进程名未匹配）**：Google Antigravity 终端模式下的核心进程名为 **`agy.exe`**，此前仅匹配了 `Antigravity.exe`。
  - **解决**：在 [`electron/main.ts`](file:///D:/vibe/agent/electron/main.ts) 中通过正则 `/(agy|Antigravity)\.exe/i` 全量感知，并实时解析 `~/.gemini/antigravity-cli/brain/` 目录中最新的会话与提问状态。

## 五、主流 AI Agent 支持矩阵 (Agent Support Matrix)

| Agent | 接入机制 | 支持特性 | 启动与使用方式 |
| :--- | :--- | :--- | :--- |
| **Google Antigravity** | 全自动无感扫描 (`agy.exe`) | 多开分身区分、思考/提问状态解析、一键终端切屏 | 直接在终端运行 `agy`（自动聚合） |
| **OpenCode** | 全自动无感扫描 (`opencode.exe`) | 多开分身区分、会话存活监听、一键终端切屏 | 直接在终端运行 `opencode`（自动聚合） |
| **Hermes Agent** | 全自动无感扫描 (`hermes.exe`) | 会话存活监听、耗时追踪、一键终端切屏 | 直接在终端运行 `hermes` 或 `hermes-agent`（自动聚合） |
| **Claude Code** | 原生 `PreToolUse` Hook + 自动感知 | **高危命令审批拦截**、允许/拒绝、自动降级、终端聚焦 | 运行 `node scripts/install-claude-hook.js` 一键挂载 |
