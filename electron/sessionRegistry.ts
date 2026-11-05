export type SessionStatus = 'running' | 'waiting' | 'completed' | 'unknown';
export type SessionSource = 'hook' | 'log' | 'process';

export interface SessionInfo {
  sessionId: string;
  agent: string;
  pid?: number;
  cwd?: string;
  status: SessionStatus;
  source: SessionSource;
  updatedAt: number;
  pendingRequestId?: string;
}

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private listeners = new Set<(sessions: SessionInfo[]) => void>();

  /**
   * 插入或更新会话信息。
   * 以 sessionId 为唯一主键，绝不按 agent 类型聚合。
   * 自动合并传入的字段并刷新 updatedAt（若未显式指定）。
   */
  upsert(partial: Partial<SessionInfo> & { sessionId: string }): SessionInfo {
    const existing = this.sessions.get(partial.sessionId);
    const now = Date.now();

    const merged: SessionInfo = {
      sessionId: partial.sessionId,
      agent: partial.agent ?? existing?.agent ?? 'unknown',
      status: partial.status ?? existing?.status ?? 'unknown',
      source: partial.source ?? existing?.source ?? 'process',
      updatedAt: partial.updatedAt ?? now,
      pid: partial.pid !== undefined ? partial.pid : existing?.pid,
      cwd: partial.cwd !== undefined ? partial.cwd : existing?.cwd,
      pendingRequestId: partial.pendingRequestId !== undefined ? partial.pendingRequestId : existing?.pendingRequestId,
    };

    this.sessions.set(partial.sessionId, merged);
    this.notify();
    return merged;
  }

  /**
   * 根据 sessionId 获取单个会话
   */
  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话列表
   */
  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 移除指定会话
   */
  remove(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.notify();
    }
    return deleted;
  }

  /**
   * 根据存活的 PID 列表清理已退出的会话。
   * 只要 session 绑定了 pid 且不在 alivePids 中，即视为已死亡并清理。
   */
  markDeadByPid(alivePids: Set<number> | number[]): void {
    const aliveSet = alivePids instanceof Set ? alivePids : new Set(alivePids);
    let changed = false;

    for (const [id, session] of this.sessions.entries()) {
      if (session.pid !== undefined && !aliveSet.has(session.pid)) {
        this.sessions.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
  }

  /**
   * 注册变更监听回调，返回取消监听的注销函数
   */
  onChange(callback: (sessions: SessionInfo[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * 清空所有会话（用于重置或测试）
   */
  clear(): void {
    if (this.sessions.size > 0) {
      this.sessions.clear();
      this.notify();
    }
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const currentList = this.list();
    for (const listener of this.listeners) {
      try {
        listener(currentList);
      } catch (err) {
        console.error('[SessionRegistry] Listener error:', err);
      }
    }
  }
}
