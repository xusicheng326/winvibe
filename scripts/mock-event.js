#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

function getDaemonConfig() {
  const daemonPath = path.join(os.homedir(), '.winvibe', 'daemon.json');
  if (!fs.existsSync(daemonPath)) return null;
  return JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
}

const daemon = getDaemonConfig();
if (!daemon) {
  console.error('WinVibe daemon 未运行，请先启动应用');
  process.exit(1);
}

const event = {
  session_id: 'claude-session-' + Math.floor(Math.random() * 100),
  agent_name: 'Claude Code',
  status: 'running',
  message: '正在重构用户鉴权与状态机模块...',
  timestamp: Date.now(),
};

const postData = JSON.stringify(event);
const req = http.request(
  {
    hostname: '127.0.0.1',
    port: daemon.port,
    path: '/api/v1/agent/event',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${daemon.token}`,
      'Content-Length': Buffer.byteLength(postData),
    },
  },
  (res) => {
    console.log(`[mock-event] 事件发送成功，HTTP 状态码: ${res.statusCode}`);
  }
);

req.on('error', (err) => {
  console.error('[mock-event] 发送失败:', err.message);
});

req.write(postData);
req.end();
