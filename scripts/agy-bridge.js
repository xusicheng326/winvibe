#!/usr/bin/env node
/**
 * WinVibe <-> Google Antigravity 官方适配桥接器 (高性能无阻塞版)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const logFile = path.join(os.homedir(), '.winvibe', 'bridge.log');

function log(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch {}
}

function getDaemonConfig() {
  const daemonPath = path.join(os.homedir(), '.winvibe', 'daemon.json');
  if (!fs.existsSync(daemonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
  } catch {
    return null;
  }
}

async function sendEvent(daemon, payload) {
  if (!daemon) return;
  const postData = JSON.stringify(payload);
  return new Promise((resolve) => {
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
      timeout: 1000,
    }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

const eventType = process.argv[2] || 'PreInvocation';
log(`Hook triggered: ${eventType}`);

const daemon = getDaemonConfig();

async function run() {
  if (eventType === 'PreInvocation') {
    log('Reporting PreInvocation running status to WinVibe');
    await sendEvent(daemon, {
      session_id: 'antigravity-active-session',
      agent_name: 'Google Antigravity',
      status: 'running',
      message: '正在思考与分析需求...',
      pid: process.pid,
    });
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  if (eventType === 'Stop') {
    log('Reporting Stop completed status to WinVibe');
    await sendEvent(daemon, {
      session_id: 'antigravity-active-session',
      agent_name: 'Google Antigravity',
      status: 'completed',
      message: '任务已完成，等待下一条指令',
      pid: process.pid,
    });
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // PreToolUse: 读取少量 stdin (超时保护 300ms)
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { input += chunk; });

  const finishToolUse = async () => {
    let payload = {};
    try {
      if (input.trim()) payload = JSON.parse(input);
    } catch {}

    const toolName = payload.toolCall?.name || 'tool';
    const toolArgs = payload.toolCall?.args || {};
    log(`PreToolUse tool: ${toolName}`);

    if (toolName === 'ask_question') {
      const q = toolArgs.questions?.[0]?.question || '等待用户回答提问';
      await sendEvent(daemon, {
        session_id: 'antigravity-active-session',
        agent_name: 'Google Antigravity',
        status: 'waiting',
        message: `等待输入: ${q}`,
        pid: process.pid,
      });
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      process.exit(0);
    }

    // 常规工具上报运行态
    await sendEvent(daemon, {
      session_id: 'antigravity-active-session',
      agent_name: 'Google Antigravity',
      status: 'running',
      message: `执行工具: ${toolName}`,
      pid: process.pid,
    });

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  };

  const timer = setTimeout(finishToolUse, 300);
  process.stdin.on('end', () => {
    clearTimeout(timer);
    finishToolUse();
  });
}

run();
