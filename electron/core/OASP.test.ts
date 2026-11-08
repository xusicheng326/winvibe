import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub } from './SessionHub.js';
import { AuditService } from '../services/AuditService.js';
import { TelemetryService } from '../services/TelemetryService.js';
import { HttpDaemon } from './HttpDaemon.js';
import http from 'node:http';

test('OASP - 本地 HTTP 守护服务端点与鉴权', async () => {
  const sessionHub = new SessionHub();
  const auditService = new AuditService();
  const telemetryService = new TelemetryService();
  const daemon = new HttpDaemon(sessionHub, auditService, telemetryService);

  await daemon.start();
  const port = daemon.getPort();
  const token = daemon.getToken();

  try {
    // 1. 无 Token 请求应被拦截 401
    const unauthRes = await makePost(port, '', '/api/v1/agent/pulse', { name: 'Test' });
    assert.equal(unauthRes.status, 401);

    // 2. 带合法 Token 发送 OASP pulse 心跳
    const authRes = await makePost(port, token, '/api/v1/agent/pulse', {
      session_id: 'test-custom-1',
      name: 'Custom AutoGen Agent',
      status: 'running',
      message: '正在进行多智能体协同...',
    });
    assert.equal(authRes.status, 200);
    assert.equal(authRes.data.acknowledged, true);

    // 验证 SessionHub 是否正确登记了该自定义 Agent
    const sess = sessionHub.getSession('test-custom-1');
    assert.ok(sess);
    assert.equal(sess.name, 'Custom AutoGen Agent');
    assert.equal(sess.status, 'running');
    assert.equal(sess.source, 'oasp');

    // 3. 遥测状态端点 GET /api/v1/status
    const statusRes = await makeGet(port, token, '/api/v1/status');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.sessions, 1);
  } finally {
    await daemon.stop();
  }
});

function makePost(port: number, token: string, path: string, body: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(data)),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(resBody) });
          } catch {
            resolve({ status: res.statusCode || 0, data: resBody });
          }
        });
      }
    );
    req.on('error', () => resolve({ status: 500, data: null }));
    req.write(data);
    req.end();
  });
}

function makeGet(port: number, token: string, path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(resBody) });
          } catch {
            resolve({ status: res.statusCode || 0, data: resBody });
          }
        });
      }
    );
    req.on('error', () => resolve({ status: 500, data: null }));
    req.end();
  });
}
