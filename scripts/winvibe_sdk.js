/**
 * WinVibe OASP (Open Agent Status Protocol) Node.js SDK
 * 零外部依赖，使用 Node.js 内置 http/fs 模块，一行代码接入灵动岛
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class WinVibeClient {
  constructor(agentName = 'Node.js Agent') {
    this.agentName = agentName;
    this.port = 18989;
    this.token = '';
    this.pid = process.pid;
    this.sessionId = `node-${agentName.replace(/\s+/g, '-').toLowerCase()}-${this.pid}`;
    this.loadDaemonConfig();
  }

  loadDaemonConfig() {
    try {
      const daemonPath = path.join(os.homedir(), '.winvibe', 'daemon.json');
      if (fs.existsSync(daemonPath)) {
        const data = JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
        this.port = data.port || 18989;
        this.token = data.token || '';
        return !!this.token;
      }
    } catch {}
    return false;
  }

  request(endpoint, payload, timeoutMs = 30000) {
    return new Promise((resolve) => {
      if (!this.token && !this.loadDaemonConfig()) {
        return resolve(null);
      }

      const postData = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${this.token}`,
          },
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 发送状态心跳
   */
  async pulse(status = 'running', message = '', cwd = process.cwd(), metrics = null) {
    const payload = {
      session_id: this.sessionId,
      name: this.agentName,
      status,
      message,
      pid: this.pid,
      cwd,
      metrics,
    };
    const res = await this.request('/api/v1/agent/pulse', payload, 3000);
    return !!(res && res.acknowledged);
  }

  /**
   * 阻塞请求高危审批
   */
  async requestApproval(command, toolName = 'Bash', cwd = process.cwd(), timeoutMs = 30000) {
    const payload = {
      request_id: `req-node-${Date.now()}`,
      session_id: this.sessionId,
      agent_name: this.agentName,
      tool_name: toolName,
      command,
      cwd,
      pid: this.pid,
      timeout_ms: timeoutMs,
    };
    const res = await this.request('/api/v1/decision/request', payload, timeoutMs + 2000);
    return res ? res.action : 'allow';
  }

  /**
   * 弹出问答卡片
   */
  async askQuestion(question, options = ['确认', '取消'], timeoutMs = 30000) {
    const payload = {
      request_id: `req-node-q-${Date.now()}`,
      session_id: this.sessionId,
      agent_name: this.agentName,
      tool_name: 'ask_question',
      type: 'question',
      question,
      options,
      pid: this.pid,
      timeout_ms: timeoutMs,
    };
    const res = await this.request('/api/v1/decision/request', payload, timeoutMs + 2000);
    return res ? res.selected_option || res.action : null;
  }
}
