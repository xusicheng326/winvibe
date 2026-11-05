# WinVibe Agent Hub (Windows 灵动岛 AI Agent 控制台)

Windows 桌面端专为 **Claude Code** 及各类 AI 编程 Agent 打造的原生悬浮“灵动岛”控制中心。

## 核心特性
- **屏幕顶栏悬浮胶囊**：始终置顶、透明无边框、微缩态下仅占极小区域，提供 Fluent 毛玻璃半透明优雅动效。
- **动态鼠标穿透**：胶囊以外区域完全穿透，不遮挡下方浏览器标签或编辑器操作，移入交互区域自动捕获鼠标。
- **多会话精准隔离 (SessionRegistry)**：以 `sessionId` 为唯一主键独立注册管理，同一 Agent 开启多个终端会话互不影响，各自独立呈现推理中、等待审批与已完成状态，彻底杜绝多终端状态串台。
- **CWD 智能目录区分**：同类多开会话自动基于工作目录（`cwd`）识别并呈现，如 `Claude Code (frontend)` 与 `Claude Code (backend)`，告别抽象模糊的 `(#1)` / `(#2)` 编号。
- **定向目标决策与 FIFO 队列机制**：
  - 多会话同时等待时，灵动岛顶栏展示多任务切换导航，并高亮标注当前目标；
  - 全局快捷键 `Alt+Y / Alt+N` 严格按照“先到先处理（FIFO）”原则批准队首会话，支持手动点击无缝切换操作目标；
  - 严格安全守卫：无待处理会话时快捷键自动静默忽略，严禁向系统盲目发键。
- **Hook 闭环直通与按键堆积防护**：对来自 Hook 的审批会话，直接通过 HTTP 协议回复终端决策，**全程不调用底层控制台按键注入**，从根源上彻底解决控制台输入缓冲区残留 `'1'` 与换行错发问题。
- **Claude Code 官方 Hooks 全生命周期接入**：集成 `PreToolUse`（高危命令拦截）、`UserPromptSubmit`（实时推理感知）、`Stop`（任务完成捕获），支持安全备份与一键卸载还原。
- **主流 Agent 深度状态感知**：全面适配 Google Antigravity、OpenCode、Hermes Agent 与 Claude Code，精确识别推理中、执行工具、等待交互、报错与完成等状态。
- **Windows 原生 Toast 通知**：Agent 任务执行完毕后弹出系统级通知，点击通知直接聚焦切回对应终端。
- **安全审计历史回溯 (Audit Dashboard)**：展开面板集成【活跃会话】、【任务计划】与【安全审计】多标签页，完整记录每条拦截、放行或超时的 Bash 指令，支持一键清空。
- **全局快捷键响应**：支持 `Alt+Y` 快速批准、`Alt+N` 快速拒绝/拦截、`Alt+V` / `Alt+Shift+V` 呼出/展开灵动岛。
- **系统托盘驻留与免打扰**：托盘右键菜单支持显示/隐藏、免打扰 (DND)、开机自启、重载与快捷操作。
- **单实例运行保护**：内置单实例互斥锁与异常静默兜底，杜绝重复启动报端口冲突错误。
- **一键切回终端 (Jump-Back)**：点击卡片或通知直达 Windows Terminal / VS Code 对应窗口。

---

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

---

### 2. Claude Code 一键接入与卸载

#### ① 一键安装 Hook（官方规范，全自动生命周期）
```bash
node scripts/install-claude-hook.js
```
* 自动在写入前将 `~/.claude/settings.json` 备份为 `settings.json.bak.<时间戳>`；
* 自动注册 `PreToolUse`、`UserPromptSubmit`、`Stop` 三大钩子；
* 严格保留用户原有的其他自定义 Hook，重复执行保持幂等。

#### ② 彻底卸载与还原 Hook
```bash
node scripts/install-claude-hook.js --uninstall
```
* 安全从 `settings.json` 中移除 WinVibe 相关钩子，保留用户原有配置并自动备份。

---

### 3. 多终端并发与定向快捷键交互流

当多个终端并发运行或同时发起命令审批时：
1. **多任务队列呈现**：灵动岛卡片顶栏将展示多任务标签，如 `[frontend (当前目标)]`、`[backend]`；
2. **高亮与目录感知**：当前快捷键操作的目标卡片带有金色流光框（`ring-1 ring-amber-400`），并清晰标明所属终端的工作目录；
3. **快捷键响应**：
   - 按下 `Alt+Y`：精准只批准当前队首任务，该终端继续执行，另一个终端保持等待；
   - 再次按下 `Alt+Y`：依次批准下一个任务；
   - 支持直接在界面点击不同终端标签切换操作目标；
   - 所有任务处理完毕后，按 `Alt+Y / Alt+N` 完全静默退出，不会对终端产生任何多余按键干扰。

---

### 4. 主流 Agent 适配矩阵

| Agent | 接入体验 | 对应操作 / 命令 | 状态感知方式 |
| :--- | :--- | :--- | :--- |
| **Claude Code** | **原生审批拦截 + 生命周期精准隔离** | 1. 运行 `node scripts/install-claude-hook.js`<br>2. 终端直接运行 `claude` | Hook 阻塞审批 + 协议上报 (`SessionRegistry`) |
| **Google Antigravity** | **全自动无感感知** | 终端直接敲 `agy`（支持多窗口会话隔离） | 日志深度嗅探与终端交互识别 |
| **OpenCode** | **全自动无感感知** | 终端直接敲 `opencode`（自动捕捉进程并显示） | `opencode.log` 运行特征实时解析 |
| **Hermes Agent** | **全自动无感感知** | 终端直接敲 `hermes` 或 `hermes-agent` | `agent.log` 推理与工具调用解析 |

---

## 详细架构与审计文档
* 详细系统架构与迭代进度：👉 [PROJECT_PLAN.md](file:///D:/vibe/agent/PROJECT_PLAN.md)
* 架构演进与状态数据流代码审计报告：👉 [docs/AUDIT.md](file:///D:/vibe/agent/docs/AUDIT.md)

---
*Created & Maintained by Vibe Coding in `D:\vibe\agent`*
