#!/usr/bin/env node
/**
 * WinVibe 通用 Agent 包装器 (适用于 OpenCode / Hermes Agent / 自定义 CLI)
 * 作用：启动命令并在灵动岛建立会话监控、耗时追踪与点击窗口回溯 (Jump-Back)
 * 用法：node scripts/vibe-run.js --agent "Hermes Agent" -- python ...
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function getDaemonConfig() {
  const daemonPath = path.join(os.homedir(), '.winvibe', 'daemon.json');
  if (!fs.existsSync(daemonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
  } catch {
    return null;
  }
}

function sendEvent(daemon, payload) {
  if (!daemon) return;
  const postData = JSON.stringify(payload);
  const req = http.request({
    hostname: '127.0.0.1',
    port: daemon.port,
    path: '/api/v1/agent/event',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${daemon.token}`,
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 2000,
  });
  req.on('error', () => {});
  req.write(postData);
  req.end();
}

const args = process.argv.slice(2);
let agentName = 'AI Agent';
let cmdIndex = -1;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentName = args[i + 1];
    i++;
  } else if (args[i] === '--') {
    cmdIndex = i + 1;
    break;
  }
}

const commandArgs = cmdIndex >= 0 ? args.slice(cmdIndex) : args;
if (commandArgs.length === 0) {
  console.log('用法: node vibe-run.js [--agent "Agent名称"] -- <要执行的命令>');
  process.exit(1);
}

const daemon = getDaemonConfig();
const sessionId = `${agentName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
const targetCmd = commandArgs[0];
const targetParams = commandArgs.slice(1);

console.log(`[WinVibe] 正在启动并监控 ${agentName}: ${commandArgs.join(' ')}`);

// 上报会话启动
sendEvent(daemon, {
  session_id: sessionId,
  agent_name: agentName,
  status: 'running',
  message: `执行命令: ${commandArgs.join(' ')}`,
  pid: process.pid,
});

const child = spawn(targetCmd, targetParams, {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  sendEvent(daemon, {
    session_id: sessionId,
    agent_name: agentName,
    status: code === 0 ? 'completed' : 'error',
    message: code === 0 ? '任务执行完毕' : `任务异常退出 (代码 ${code})`,
    pid: process.pid,
  });
  process.exit(code ?? 0);
});
