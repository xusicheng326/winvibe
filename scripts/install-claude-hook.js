#!/usr/bin/env node
/**
 * WinVibe Claude Code Hook 自动配置安装与卸载脚本
 * 严格对齐 Claude Code 官方 settings.json 中的 Hook 规范：
 * - PreToolUse: 命令执行前拦截审批
 * - UserPromptSubmit: 用户提交 prompt 时记录 session 处于 running 状态
 * - Stop: Agent 停止交互时记录 session 处于 completed 状态
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const hookScriptPath = path.resolve(__dirname, 'vibe-hook.js').replace(/\\/g, '/');

const isUninstall = process.argv.includes('--uninstall') || process.argv.includes('--disable');

function ensureBackup() {
  if (fs.existsSync(settingsPath)) {
    const timestamp = Date.now();
    const backupPath = path.join(claudeDir, `settings.json.bak.${timestamp}`);
    try {
      fs.copyFileSync(settingsPath, backupPath);
      console.log(`📦 已备份原配置至: ${backupPath}`);
      return backupPath;
    } catch (err) {
      console.warn('⚠️ 备份 settings.json 失败:', err.message);
    }
  }
  return null;
}

function loadSettings() {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    console.error('读取 settings.json 失败，将重置为空对象:', err.message);
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// 判断某个 hook 条目是否与 WinVibe 相关（兼容新旧两种 schema）
function isWinVibeHook(entry) {
  if (!entry) return false;
  // 扁平格式: { command: '...' }
  if (typeof entry.command === 'string' && entry.command.includes('vibe-hook.js')) {
    return true;
  }
  // 嵌套格式: { matcher?: '...', hooks: [{ type: 'command', command: '...' }] }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(h => typeof h.command === 'string' && h.command.includes('vibe-hook.js'));
  }
  return false;
}

// 写入前先备份
ensureBackup();

const settings = loadSettings();
settings.hooks = settings.hooks || {};

const targetEvents = ['PreToolUse', 'UserPromptSubmit', 'Stop'];

// 幂等清理已存在的 WinVibe Hook，保留用户其他自定义 hook
for (const eventName of targetEvents) {
  if (Array.isArray(settings.hooks[eventName])) {
    settings.hooks[eventName] = settings.hooks[eventName].filter(entry => !isWinVibeHook(entry));
    if (settings.hooks[eventName].length === 0 && isUninstall) {
      delete settings.hooks[eventName];
    }
  }
}

if (isUninstall) {
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  saveSettings(settings);
  console.log('✅ 已成功从 ~/.claude/settings.json 中彻底移除 WinVibe 所有 Hooks (--uninstall)');
  process.exit(0);
}

// 注入规范结构 (保留用户其他已有 hooks，幂等追加)
settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
settings.hooks.PreToolUse.push({
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command: `node "${hookScriptPath}"`,
    },
  ],
});

settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
settings.hooks.UserPromptSubmit.push({
  hooks: [
    {
      type: 'command',
      command: `node "${hookScriptPath}" UserPromptSubmit`,
    },
  ],
});

settings.hooks.Stop = settings.hooks.Stop || [];
settings.hooks.Stop.push({
  hooks: [
    {
      type: 'command',
      command: `node "${hookScriptPath}" Stop`,
    },
  ],
});

saveSettings(settings);

console.log('✅ 成功将 WinVibe 完整 Hooks 注册至 ~/.claude/settings.json：');
console.log('   - PreToolUse       -> 命令审批拦截 (阻塞等待)');
console.log('   - UserPromptSubmit -> 用户提问感知 (running)');
console.log('   - Stop             -> 任务结束感知 (completed)');
console.log('👉 脚本路径:', hookScriptPath);
