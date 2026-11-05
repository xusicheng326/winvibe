#!/usr/bin/env node
/**
 * WinVibe Google Antigravity (AGY) Hook 自动配置安装脚本
 * 自动为用户目录 (~/.agents/hooks.json) 及当前工作区注入全生命周期监听器
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bridgeScriptPath = path.resolve(__dirname, 'agy-bridge.js').replace(/\\/g, '/');

const targetPaths = [
  path.join(os.homedir(), '.agents', 'hooks.json'),
  path.join(process.cwd(), '.agents', 'hooks.json'),
];

const hookConfig = {
  "winvibe-bridge": {
    "enabled": true,
    "PreInvocation": [
      {
        "type": "command",
        "command": `node "${bridgeScriptPath}" PreInvocation`,
        "timeout": 5
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": `node "${bridgeScriptPath}" Stop`,
        "timeout": 5
      }
    ],
    "PreToolUse": [
      {
        "matcher": "run_command|ask_question",
        "hooks": [
          {
            "type": "command",
            "command": `node "${bridgeScriptPath}" PreToolUse`,
            "timeout": 35
          }
        ]
      }
    ]
  }
};

for (const hp of targetPaths) {
  const dir = path.dirname(hp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing = {};
  if (fs.existsSync(hp)) {
    try {
      existing = JSON.parse(fs.readFileSync(hp, 'utf-8'));
    } catch {}
  }

  existing["winvibe-bridge"] = hookConfig["winvibe-bridge"];
  fs.writeFileSync(hp, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`✅ 已配置 Antigravity 灵动岛 Hook: ${hp}`);
}
