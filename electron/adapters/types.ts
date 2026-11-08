/**
 * 通用 Agent 适配层核心类型定义 (Unified Agent Protocol & Types)
 */

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'error';

export interface AgentInstance {
  id: string;             // 全局唯一标识，如 "claude-sess-1234" 或 "agy-5678"
  sessionId?: string;
  name: string;           // 友好名称，如 "Claude Code (frontend)" 或 "Google Antigravity"
  agentType: 'claude' | 'antigravity' | 'opencode' | 'hermes' | 'cursor' | 'generic';
  status: AgentStatus;
  lastMessage: string;
  startTime: number;
  pid?: number;
  cwd?: string;
  source: 'hook' | 'log' | 'process' | 'oasp';
  metrics?: SessionMetrics;
}

export interface SessionMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  contextUsagePercent?: number;
  stepCount?: number;
  rateLimit5HrPercent?: number;
  rateLimitResetTime?: string;
}

export type DecisionAction = 'allow' | 'deny' | 'ask';

export interface DecisionPayload {
  request_id: string;
  session_id?: string;
  agent_name: string;
  tool_name: string;
  command?: string;
  cwd?: string;
  pid?: number;
  timeout_ms?: number;
  type?: 'approval' | 'question' | 'complex_question';
  question?: string;
  summary?: string;
  options?: Array<string | { key?: string; label: string; value?: string }>;
  timestamp: number;
}

export interface AgentEvent {
  type: 'status_change' | 'decision_request' | 'decision_resolved' | 'metrics_update' | 'heartbeat';
  session: AgentInstance;
  payload?: any;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly agentType: 'claude' | 'antigravity' | 'opencode' | 'hermes' | 'cursor' | 'generic';
  
  init(): Promise<void>;
  destroy(): Promise<void>;
  handleDecision?(requestId: string, action: DecisionAction, selectedOption?: string): Promise<void>;
  abortSession?(sessionId: string, pid?: number): Promise<void>;
}
