import type { AgentInstance, DecisionPayload, DecisionAction } from '../adapters/types.js';
import { Win32Bridge } from './Win32Bridge.js';

export class SessionHub {
  private sessions = new Map<string, AgentInstance>();
  private decisionQueue = new Map<string, { payload: DecisionPayload; resolve?: (action: DecisionAction, input?: string) => void }>();
  private targetSessionId: string | null = null;
  private onSessionsChangeCallback?: (sessions: AgentInstance[]) => void;
  private onDecisionChangeCallback?: (queue: DecisionPayload[]) => void;

  public setCallbacks(
    onSessionsChange: (sessions: AgentInstance[]) => void,
    onDecisionChange: (queue: DecisionPayload[]) => void
  ) {
    this.onSessionsChangeCallback = onSessionsChange;
    this.onDecisionChangeCallback = onDecisionChange;
  }

  public upsertSession(session: Partial<AgentInstance> & { id: string; name?: string }): AgentInstance {
    // 严格会话消歧与多终端隔离准则：
    // 1. 如果显式给定了相同 id，直接更新
    // 2. 任何具有不同非零 PID (如 PID 23560 vs 27636) 的终端，严格认定为独立多开窗口，绝对严禁暴力合流！
    // 3. 拥有相同非零 PID (如 PID 8112) 的 process 与 log 会话，必为同一个终端，自动升级并清理占位 ID，杜绝会话数莫名其妙 +1
    let targetId = session.id;

    if (!this.sessions.has(targetId) && session.agentType && session.agentType !== 'generic') {
      const match = Array.from(this.sessions.values()).find(s => {
        if (s.agentType !== session.agentType) return false;
        // 相同 PID：100% 确认属于同一终端
        if (s.pid && session.pid && s.pid === session.pid) return true;
        // 单方未绑定 PID：允许日志会话与进程会话进行首次关联
        if ((!s.pid && session.pid) || (s.pid && !session.pid)) return true;
        return false;
      });

      if (match) {
        if (match.source === 'process' && session.source === 'log') {
          // 将 process 占位会话平滑升级为真实 log 会话，彻底删除旧占位 key
          this.sessions.delete(match.id);
          targetId = session.id;
        } else {
          targetId = match.id;
        }
      }
    }

    const existing = this.sessions.get(targetId);
    const updated: AgentInstance = {
      id: targetId,
      sessionId: session.sessionId || existing?.sessionId || targetId,
      name: session.name || existing?.name || 'AI Agent',
      agentType: session.agentType || existing?.agentType || 'generic',
      status: session.status || existing?.status || 'completed',
      lastMessage: session.lastMessage !== undefined ? session.lastMessage : (existing?.lastMessage || ''),
      startTime: session.startTime || existing?.startTime || Date.now(),
      pid: session.pid || existing?.pid,
      cwd: session.cwd || existing?.cwd,
      source: session.source || existing?.source || 'process',
      metrics: session.metrics || existing?.metrics,
    };

    this.sessions.set(targetId, updated);
    this.emitSessions();
    return updated;
  }

  public removeSession(id: string): void {
    if (this.sessions.delete(id)) {
      if (this.targetSessionId === id) {
        this.targetSessionId = null;
      }
      this.emitSessions();
    }
  }

  public getSession(id: string): AgentInstance | undefined {
    return this.sessions.get(id);
  }

  public getAllSessions(): AgentInstance[] {
    return Array.from(this.sessions.values());
  }

  public setTargetSession(id: string | null): void {
    this.targetSessionId = id;
  }

  public getTargetSession(): AgentInstance | null {
    if (this.targetSessionId && this.sessions.has(this.targetSessionId)) {
      return this.sessions.get(this.targetSessionId)!;
    }
    // 默认选取队列中的首个 waiting 会话，若无则选取首个活跃会话
    const waiting = Array.from(this.sessions.values()).find(s => s.status === 'waiting');
    if (waiting) return waiting;
    return this.sessions.values().next().value || null;
  }

  public enqueueDecision(
    payload: DecisionPayload,
    resolve?: (action: DecisionAction, input?: string) => void
  ): void {
    this.decisionQueue.set(payload.request_id, { payload, resolve });
    this.emitDecisions();
  }

  public getDecisionQueue(): DecisionPayload[] {
    return Array.from(this.decisionQueue.values()).map(item => item.payload);
  }

  public getDecision(requestId: string) {
    return this.decisionQueue.get(requestId);
  }

  public resolveDecision(requestId: string, action: DecisionAction, selectedOption?: string): boolean {
    const item = this.decisionQueue.get(requestId);
    if (!item) return false;

    this.decisionQueue.delete(requestId);
    this.emitDecisions();

    if (item.resolve) {
      item.resolve(action, selectedOption);
      return true;
    }

    // 若无 HTTP 阻塞回调，检查对应会话是否有 pid，通过 Win32Bridge 仿真
    const targetSession = Array.from(this.sessions.values()).find(s => s.sessionId === item.payload.session_id || s.pid === item.payload.pid);
    if (targetSession && targetSession.pid) {
      Win32Bridge.sendConsoleKey(action === 'allow' ? 'allow' : 'deny', targetSession.pid);
    }

    return true;
  }

  public resolveTargetOrHead(action: DecisionAction): { handled: boolean; requestId?: string; targetSession?: AgentInstance | null } {
    const queue = Array.from(this.decisionQueue.entries());
    if (queue.length > 0) {
      // 优先处理当前选中目标，否则 FIFO 取队首
      let targetEntry = queue[0];
      if (this.targetSessionId) {
        const found = queue.find(([_, v]) => v.payload.session_id === this.targetSessionId || v.payload.request_id === this.targetSessionId);
        if (found) targetEntry = found;
      }

      const [requestId, item] = targetEntry;
      this.resolveDecision(requestId, action);
      const session = this.sessions.get(item.payload.session_id || '') || null;
      return { handled: true, requestId, targetSession: session };
    }

    // 备用：无 HTTP 队列时，尝试对处于 waiting 的终端实例执行底层按键
    const target = this.getTargetSession();
    if (target && target.status === 'waiting' && target.pid) {
      Win32Bridge.sendConsoleKey(action === 'allow' ? 'allow' : 'deny', target.pid);
      return { handled: true, targetSession: target };
    }

    return { handled: false };
  }

  public clearAllDecisions(): void {
    this.decisionQueue.clear();
    this.emitDecisions();
  }

  private emitSessions() {
    if (this.onSessionsChangeCallback) {
      this.onSessionsChangeCallback(this.getAllSessions());
    }
  }

  private emitDecisions() {
    if (this.onDecisionChangeCallback) {
      this.onDecisionChangeCallback(this.getDecisionQueue());
    }
  }
}
