import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { SessionHub } from './SessionHub.js';
import type { AuditService } from '../services/AuditService.js';
import type { TelemetryService } from '../services/TelemetryService.js';
import type { DecisionPayload, DecisionAction } from '../adapters/types.js';

export class HttpDaemon {
  private server: http.Server | null = null;
  private port = 18989;
  private authToken: string;
  private sessionHub: SessionHub;
  private auditService: AuditService;
  private telemetryService: TelemetryService;

  constructor(sessionHub: SessionHub, auditService: AuditService, telemetryService: TelemetryService) {
    this.sessionHub = sessionHub;
    this.auditService = auditService;
    this.telemetryService = telemetryService;
    this.authToken = crypto.randomBytes(24).toString('hex');
    this.persistDaemonState();
  }

  public getPort(): number {
    return this.port;
  }

  public getToken(): string {
    return this.authToken;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[HttpDaemon] 端口 ${this.port} 已被占用，正在尝试 +1 备用端口...`);
          this.port++;
          this.persistDaemonState();
          this.server?.listen(this.port, '127.0.0.1');
        } else {
          console.error('[HttpDaemon] 服务异常:', err);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[HttpDaemon] 本地控制中枢已启动: 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const clientIp = req.socket.remoteAddress;
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${this.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          this.routePost(req.url || '/', payload, res);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/api/v1/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        sessions: this.sessionHub.getAllSessions().length,
        telemetry: this.telemetryService.getGlobalTelemetry(),
      }));
    } else if (req.method === 'GET' && req.url === '/api/v1/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.sessionHub.getAllSessions()));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private routePost(url: string, payload: any, res: http.ServerResponse) {
    if (url === '/api/v1/decision/request') {
      this.handleDecisionRequest(payload, res);
    } else if (url === '/api/v1/decision/response') {
      this.handleDecisionResponse(payload, res);
    } else if (url === '/api/v1/agent/event') {
      this.handleAgentEvent(payload, res);
    } else if (url === '/api/v1/agent/pulse') {
      this.handleAgentPulse(payload, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found' }));
    }
  }

  private handleDecisionRequest(payload: any, res: http.ServerResponse) {
    const requestId = payload.request_id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sessionId = payload.session_id || (payload.pid ? `claude-${payload.pid}` : requestId);
    const timeoutMs = payload.timeout_ms || 30000;
    const command = payload.command || payload.tool_input?.command || payload.toolInput?.command || '';
    const cwd = payload.cwd || '';

    const decision: DecisionPayload = {
      request_id: requestId,
      session_id: sessionId,
      agent_name: payload.agent_name || 'Claude Code',
      tool_name: payload.tool_name || payload.toolName || 'Bash',
      command,
      cwd,
      pid: payload.pid,
      timeout_ms: timeoutMs,
      type: payload.type || 'approval',
      question: payload.question,
      options: payload.options,
      timestamp: Date.now(),
    };

    // 登记/更新会话状态为 waiting
    this.sessionHub.upsertSession({
      id: sessionId,
      sessionId,
      name: `${decision.agent_name}${cwd ? ` (${path.basename(cwd)})` : ''}`,
      agentType: 'claude',
      status: 'waiting',
      lastMessage: command ? `等待审批: ${command.slice(0, 40)}...` : '等待用户交互确认...',
      pid: payload.pid,
      cwd,
      source: 'hook',
    });

    let isResolved = false;
    const timer = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      this.sessionHub.resolveDecision(requestId, 'ask');
      this.auditService.addRecord({
        id: requestId,
        agent_name: decision.agent_name,
        tool_name: decision.tool_name,
        command: decision.command || '',
        cwd: decision.cwd,
        pid: decision.pid,
        action: 'timeout',
        timestamp: Date.now(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ request_id: requestId, action: 'ask', reason: 'timeout' }));
    }, timeoutMs);

    this.sessionHub.enqueueDecision(decision, (action: DecisionAction, selectedOption?: string) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);

      this.auditService.addRecord({
        id: requestId,
        agent_name: decision.agent_name,
        tool_name: decision.tool_name,
        command: decision.command || '',
        cwd: decision.cwd,
        pid: decision.pid,
        action: action === 'allow' ? 'allow' : 'deny',
        timestamp: Date.now(),
      });

      // 恢复会话状态为 running
      this.sessionHub.upsertSession({
        id: sessionId,
        status: 'running',
        lastMessage: action === 'allow' ? '已批准继续运行' : '已拦截该操作',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        request_id: requestId,
        action,
        selected_option: selectedOption,
      }));
    });
  }

  private handleDecisionResponse(payload: any, res: http.ServerResponse) {
    const { requestId, action, selectedOption } = payload;
    if (!requestId || !action) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing requestId or action' }));
    }
    const handled = this.sessionHub.resolveDecision(requestId, action, selectedOption);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: handled }));
  }

  private handleAgentEvent(payload: any, res: http.ServerResponse) {
    const sessionId = payload.session_id || (payload.pid ? `agent-${payload.pid}` : `sess-${Date.now()}`);
    this.sessionHub.upsertSession({
      id: sessionId,
      sessionId,
      name: payload.agent_name || 'AI Agent',
      status: payload.status || 'running',
      lastMessage: payload.message || '',
      pid: payload.pid,
      cwd: payload.cwd,
      source: 'hook',
    });

    if (payload.tokens) {
      this.telemetryService.recordSessionTokens(
        sessionId,
        payload.tokens.input || 0,
        payload.tokens.output || 0,
        payload.model || 'claude-3-7-sonnet'
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }

  private handleAgentPulse(payload: any, res: http.ServerResponse) {
    // 开放 OASP 协议标准入口
    const sessionId = payload.session_id || `oasp-${payload.name || 'custom'}-${payload.pid || 'anon'}`;
    this.sessionHub.upsertSession({
      id: sessionId,
      sessionId,
      name: payload.name || 'Custom Agent',
      agentType: 'generic',
      status: payload.status || 'running',
      lastMessage: payload.message || '工作中...',
      pid: payload.pid,
      cwd: payload.cwd,
      source: 'oasp',
      metrics: payload.metrics,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', acknowledged: true }));
  }

  private persistDaemonState() {
    const dir = path.join(os.homedir(), '.winvibe');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'daemon.json'), JSON.stringify({
      port: this.port,
      token: this.authToken,
      pid: process.pid,
    }, null, 2), 'utf-8');
  }
}
