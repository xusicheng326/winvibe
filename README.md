# WinVibe Agent Hub (Windows 灵动岛 AI Agent 控制台)

Windows 桌面端专为 **Claude Code** 及各类 AI 编程 Agent 打造的原生悬浮“灵动岛”控制中心。

## 核心特性
- **屏幕顶栏悬浮胶囊**：始终置顶、透明无边框、微缩态下仅占极小区域。
- **动态鼠标穿透**：胶囊以外区域完全穿透，不遮挡下方浏览器标签或编辑器操作。
- **Claude Code 审批决策闭环**：通过 `PreToolUse` Hook 实现终端外一键允许/拒绝危险命令。
- **主流 Agent 深度状态感知**：全面适配 Google Antigravity、OpenCode、Hermes Agent 与 Claude Code，精确识别推理中、执行工具、等待交互、报错与完成等状态。
- **Windows 原生 Toast 通知**：Agent 任务执行完毕后弹出系统级通知，点击通知直接聚焦切回对应终端。
- **安全审计历史回溯 (Audit Dashboard)**：展开面板集成【活跃会话】与【安全审计】双标签页，完整记录每条拦截、放行或超时的 Bash 指令，支持一键清空。
- **全局快捷键响应**：支持 `Alt+Y` 快速批准/发送确认、`Alt+N` 快速拒绝/拦截、`Alt+V` / `Alt+Shift+V` 呼出/展开灵动岛。
- **系统托盘驻留与免打扰**：托盘右键菜单支持显示/隐藏、免打扰 (DND)、开机自启、重载与快捷操作。
- **单实例运行保护**：内置进程锁与异常静默兜底，杜绝重复启动报端口冲突错误。
- **一键切回终端 (Jump-Back)**：点击卡片或通知直达 Windows Terminal / VS Code 对应窗口。

## 快速启动与体验指南

### 1. 启动灵动岛应用（一键启动）

* **方式 0（最推荐：原生绿色免安装便携版，完全无需 Node 环境）**：
  直接双击根目录生成的单文件独立程序：
  👉 [`D:\vibe\agent\WinVibe.exe`](file:///D:/vibe/agent/WinVibe.exe)（或 [`D:\vibe\agent\release\WinVibe.exe`](file:///D:/vibe/agent/release/WinVibe.exe)）
  * 内置单实例互斥机制：多次双击不会冲突报错，自动聚焦呼出已有的灵动岛。
* **方式 A (推荐双击脚本)**：
  ```cmd
  D:\vibe\agent\start.bat
  ```
  自动优先运行 `WinVibe.exe`，免去编译启动时间。
* **方式 B (源码级开发者启动)**：
  ```powershell
  $env:NODE_OPTIONS=""; $env:HTTP_PROXY=""; $env:HTTPS_PROXY=""; npm start
  ```
屏幕正上方中央将出现半透明胶囊灵动岛。

### 2. 测试 Claude Code 拦截决策闭环
保持灵动岛运行，在另一个终端窗口中执行：
```bash
node scripts/vibe-hook.js git push origin main --force
```
灵动岛会自动弹出高亮审批卡片，点击【允许 (Approve)】或【拒绝 (Deny)】，终端将立即接收到决策并继续/中断！

### 3. 全局快捷键与托盘交互
- **快捷键**：
  - `Alt+Y`：一键允许待审批指令；当无弹窗且 cmd/powershell/终端会话等待提问时，毫秒级直接响应 `y` 并回车（内置专属 C# 原生助手 `WinVibeHelper.exe`，支持就地前台识别与跨进程控制台缓冲区穿透直写）！
  - `Alt+N`：一键拒绝审批指令；或向终端发送 `n` 并回车拦截
  - `Alt+V` / `Alt+Shift+V`：全局单手呼出 / 折叠灵动岛看板
- **系统托盘**：
  - 双击右下角绿色托盘图标：快速显隐灵动岛
  - 右键托盘图标：直接点击【✅ 快速批准 / 回答通过 (Alt+Y)】、【❌ 快速拒绝 / 取消拦截 (Alt+N)】或【✨ 展开灵动岛 (Alt+V)】均可直接触发响应，亦可切换免打扰模式 (DND)、开机自启动与退出。

## 4. 主流 Agent 接入与使用指南

### ① Claude Code（一键全自动拦截审批）
```bash
node scripts/install-claude-hook.js
```
自动注入 `~/.claude/settings.json`，在执行高危命令前触发灵动岛审批。

### ② 主流 Agent 适配与启动方式

| Agent | 接入体验 | 对应操作 / 命令 |
| :--- | :--- | :--- |
| **Google Antigravity** | **全自动无感感知** | 终端直接敲 `agy`（支持多窗口 `#1`, `#2` 自动区分） |
| **OpenCode** | **全自动无感感知** | 终端直接敲 `opencode`（自动捕捉进程并显示） |
| **Hermes Agent** | **全自动无感感知** | 终端直接敲 `hermes` 或 `hermes-agent`（自动捕捉进程） |
| **Claude Code** | **原生审批拦截 + 状态感知** | 1. 运行 `node scripts/install-claude-hook.js` 启用命令拦截<br>2. 终端直接运行 `claude` |

#### 针对 Claude Code 的审批交互流：
当 Claude Code 即将执行高危 Bash 命令（如 `git push`、`rm -rf` 等）时，灵动岛会自动向下展开 **【Claude Code 权限申请】** 琥珀金弹窗：
* 完整高亮展示命令文本；
* 点击 **【允许 (Approve)】**：终端自动放行并继续；
* 点击 **【拒绝 (Deny)】**：终端自动拦截并阻止；
* 30 秒超时自动降级回退到终端原生确认，严禁阻塞工作流。

## 详细架构与开发进度
所有需求规范、通信协议以及当前的迭代进度清单均统一维护在：
👉 [PROJECT_PLAN.md](file:///D:/vibe/agent/PROJECT_PLAN.md)

---
*Created & Maintained by Vibe Coding in `D:\vibe\agent`*
