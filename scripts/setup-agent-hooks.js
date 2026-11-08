/**
 * WinVibe Agent Hub - 全 Agent 接入状态诊断与一键配置工具
 * 用法: node scripts/setup-agent-hooks.js [--status | --install | --uninstall]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const daemonPath = path.join(home, '.winvibe', 'daemon.json');
const claudeSettings = path.join(home, '.claude', 'settings.json');
const agyBrain = path.join(home, '.gemini', 'antigravity-cli', 'brain');
const opencodeDir = path.join(home, '.local', 'share', 'opencode');
const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const hermesDir = path.join(localAppData, 'hermes');
const cursorDir = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor');

console.log('\n======================================================');
console.log('       ✨ WinVibe Agent Hub 诊断与配置中枢 ✨        ');
console.log('======================================================\n');

// 1. 守护进程状态
if (fs.existsSync(daemonPath)) {
  try {
    const daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
    let isAlive = false;
    try {
      if (daemon.pid) {
        process.kill(daemon.pid, 0);
        isAlive = true;
      }
    } catch {}

    if (isAlive) {
      console.log(`[守护服务] 🟢 已就绪并在后台运行 (端口: ${daemon.port}, 宿主 PID: ${daemon.pid})`);
    } else {
      console.log(`[守护服务] ⚪ 未启动 (上次运行端口: ${daemon.port}，启动 WinVibe.exe 即可秒开)`);
    }
  } catch {
    console.log('[守护服务] 🟡 配置文件异常');
  }
} else {
  console.log('[守护服务] ⚪ 未运行 (启动 WinVibe.exe 即可自动就绪)');
}

console.log('\n--- 主流 Agent 生态适配感知检测 ---');

// 2. Claude Code 检测
let claudeHookInstalled = false;
if (fs.existsSync(claudeSettings)) {
  try {
    const content = fs.readFileSync(claudeSettings, 'utf-8');
    if (content.includes('vibe-hook')) {
      claudeHookInstalled = true;
    }
  } catch {}
}
console.log(`1. Claude Code:        ${claudeHookInstalled ? '🟢 已安装官方 Hook (全自动拦截与审批)' : '🟡 已发现配置，未安装 Hook'}`);

// 3. Google Antigravity
const hasAgy = fs.existsSync(agyBrain);
console.log(`2. Google Antigravity: ${hasAgy ? '🟢 日志感知已就绪 (支持问答识别与子 Agent 追踪)' : '⚪ 未发现本地配置'}`);

// 4. OpenCode
const hasOpencode = fs.existsSync(opencodeDir);
console.log(`3. OpenCode:           ${hasOpencode ? '🟢 运行日志自动感知就绪' : '⚪ 未安装或未运行'}`);

// 5. Hermes Agent
const hasHermes = fs.existsSync(hermesDir);
console.log(`4. Hermes Agent:       ${hasHermes ? '🟢 状态嗅探已就绪' : '⚪ 未发现日志'}`);

// 6. Cursor
const hasCursor = fs.existsSync(cursorDir);
console.log(`5. Cursor Composer:    ${hasCursor ? '🟢 本地环境已适配' : '⚪ 未发现 Cursor'}`);

console.log('\n--- 自定义 Agent / 开放协议 (OASP) ---');
console.log('💡 任何 Python / Node.js 脚本仅需引入 SDK 即可接入灵动岛:');
console.log('   Python:  from scripts.winvibe_sdk import WinVibeClient; client = WinVibeClient("MyAgent")');
console.log('   Node.js: import { WinVibeClient } from "./scripts/winvibe_sdk.js";\n');

// 处理安装命令
const args = process.argv.slice(2);
if (args.includes('--install') || args.includes('--install-claude')) {
  console.log('[配置助手] 正在一键安装 Claude Code 官方 Hook...');
  import('./install-claude-hook.js');
} else if (args.includes('--uninstall') || args.includes('--uninstall-claude')) {
  console.log('[配置助手] 正在卸载 Claude Code 官方 Hook...');
  process.argv.push('--uninstall');
  import('./install-claude-hook.js');
} else {
  console.log('提示: 执行 node scripts/setup-agent-hooks.js --install 可一键配置 Claude Hook。\n');
}
