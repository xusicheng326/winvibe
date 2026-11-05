#!/usr/bin/env node
/**
 * WinVibe Claude Code Hook 自动配置安装脚本
 * 严格对齐 Claude Code 官方 settings.json 中的 PreToolUse Hook 规范
 * 结构：hooks.PreToolUse -> [{ matcher: "Bash", hooks: [{ type: "command", command: "..." }] }]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const hookScriptPath = path.resolve(__dirname, 'vibe-hook.js');

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
    console.error('读取 settings.json 失败，正在备份为 settings.json.bak:', err.message);
    try {
      fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
    } catch {}
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

const isDisable = process.argv.includes('--disable');

const settings = loadSettings();
settings.hooks = settings.hooks || {};
if (!Array.isArray(settings.hooks.PreToolUse)) {
  settings.hooks.PreToolUse = [];
}

// 规范化 hook 执行命令
const hookCommand = `node "${hookScriptPath}"`;

// 判断某个 hook 条目是否与 WinVibe 相关（兼容新旧两种 schema）
function isWinVibeHook(entry) {
  if (!entry) return false;
  // 1. 旧版扁平格式: { matcher: 'Bash', command: '...' }
  if (typeof entry.command === 'string' && entry.command.includes('vibe-hook.js')) {
    return true;
  }
  // 2. 官方规范嵌套格式: { matcher: 'Bash', hooks: [{ type: 'command', command: '...' }] }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(h => typeof h.command === 'string' && h.command.includes('vibe-hook.js'));
  }
  return false;
}

// 清理所有已存在的旧格式或新格式 WinVibe Hook
settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry => !isWinVibeHook(entry));

if (isDisable) {
  saveSettings(settings);
  console.log('✅ 已成功从 ~/.claude/settings.json 中移除 WinVibe 拦截 Hook');
} else {
  // 注入官方规范结构
  settings.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [
      {
        type: 'command',
        command: hookCommand,
      },
    ],
  });

  saveSettings(settings);
  console.log('✅ 成功将 WinVibe 拦截 Hook 注入到 ~/.claude/settings.json（官方 PreToolUse 规范）');
  console.log('👉 挂载路径:', hookCommand);
}
