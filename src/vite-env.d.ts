/// <reference types="vite/client" />

export interface AuditRecord {
  id: string;
  agent_name: string;
  tool_name: string;
  command: string;
  cwd?: string;
  pid?: number;
  action: 'allow' | 'deny' | 'timeout' | 'ask';
  timestamp: number;
}

export interface QuestionOption {
  key?: string;
  label: string;
  value?: string;
}

export interface DecisionRequest {
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
  options?: (string | QuestionOption)[];
}

export interface ActivePlan {
  title: string;
  path: string;
  content: string;
  totalTasks: number;
  completedTasks: number;
  lastUpdated: number;
}

export interface WinVibeAPI {
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void;
  setWindowExpanded?: (expanded: boolean) => void;
  onAutoCollapse?: (callback: () => void) => () => void;
  sendDecision: (requestId: string, action: 'allow' | 'deny' | 'ask', selectedOption?: string) => void;
  onDecisionRequest: (callback: (request: DecisionRequest) => void) => () => void;
  onAgentEvent: (callback: (event: any) => void) => () => void;
  onActiveAgentsSync: (callback: (agents: any[]) => void) => () => void;
  onDecisionResolved: (callback: (data: { requestId: string; action: string }) => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  onToggleMute?: (callback: () => void) => () => void;
  onDndToggle: (callback: (isDnd: boolean) => void) => () => void;
  onShortcutDecision: (callback: (action: 'allow' | 'deny') => void) => () => void;
  onAgentQuickFeedback: (callback: (data: { action: string; agentName: string; key: string; message?: string }) => void) => () => void;
  getAuditHistory: () => Promise<AuditRecord[]>;
  clearAuditHistory: () => void;
  onAuditHistoryUpdated: (callback: (records: AuditRecord[]) => void) => () => void;
  getActivePlan: () => Promise<ActivePlan | null>;
  getTelemetry?: () => Promise<any>;
  onTelemetryUpdated?: (callback: (telemetry: any) => void) => () => void;
  focusWindow: (pid?: number, nameHint?: string, cwdHint?: string) => void;
  abortSession?: (sessionId: string, pid?: number) => void;
  minimizeOrClose: (action: 'hide' | 'close') => void;
  setTargetSession?: (sessionId: string | null) => void;
}

declare global {
  interface Window {
    winvibe?: WinVibeAPI;
  }
}
