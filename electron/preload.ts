import { contextBridge, ipcRenderer } from 'electron';

export interface WinVibeAPI {
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void;
  sendDecision: (requestId: string, action: 'allow' | 'deny' | 'ask', selectedOption?: string) => void;
  onDecisionRequest: (callback: (request: any) => void) => () => void;
  onAgentEvent: (callback: (event: any) => void) => () => void;
  onActiveAgentsSync: (callback: (agents: any[]) => void) => () => void;
  onDecisionResolved: (callback: (data: { requestId: string; action: string }) => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  onToggleMute: (callback: () => void) => () => void;
  onDndToggle: (callback: (isDnd: boolean) => void) => () => void;
  onShortcutDecision: (callback: (action: 'allow' | 'deny') => void) => () => void;
  onAgentQuickFeedback: (callback: (data: any) => void) => () => void;
  getAuditHistory: () => Promise<any[]>;
  getActivePlan: () => Promise<any | null>;
  getTelemetry: () => Promise<any>;
  onTelemetryUpdated: (callback: (telemetry: any) => void) => () => void;
  clearAuditHistory: () => void;
  onAuditHistoryUpdated: (callback: (records: any[]) => void) => () => void;
  focusWindow: (pid?: number, nameHint?: string, cwdHint?: string) => void;
  abortSession: (sessionId: string, pid?: number) => void;
  minimizeOrClose: (action: 'hide' | 'close') => void;
  setTargetSession: (sessionId: string | null) => void;
}

const api: WinVibeAPI = {
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, forward);
  },
  sendDecision: (requestId: string, action: 'allow' | 'deny' | 'ask', selectedOption?: string) => {
    ipcRenderer.send('decision-response', { requestId, action, selectedOption });
  },
  onDecisionRequest: (callback: (request: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('decision-request', handler);
    return () => ipcRenderer.removeListener('decision-request', handler);
  },
  onAgentEvent: (callback: (event: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },
  onActiveAgentsSync: (callback: (agents: any[]) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('active-agents-sync', handler);
    return () => ipcRenderer.removeListener('active-agents-sync', handler);
  },
  onDecisionResolved: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('decision-resolved', handler);
    return () => ipcRenderer.removeListener('decision-resolved', handler);
  },
  onToggleExpand: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-expand', handler);
    return () => ipcRenderer.removeListener('toggle-expand', handler);
  },
  onToggleMute: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-mute', handler);
    return () => ipcRenderer.removeListener('toggle-mute', handler);
  },
  onDndToggle: (callback: (isDnd: boolean) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('dnd-toggle', handler);
    return () => ipcRenderer.removeListener('dnd-toggle', handler);
  },
  onShortcutDecision: (callback: (action: any) => void) => {
    const handler = (_: any, action: any) => callback(action);
    ipcRenderer.on('shortcut-decision', handler);
    return () => ipcRenderer.removeListener('shortcut-decision', handler);
  },
  onAgentQuickFeedback: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('agent-quick-feedback', handler);
    return () => ipcRenderer.removeListener('agent-quick-feedback', handler);
  },
  getAuditHistory: () => ipcRenderer.invoke('get-audit-history'),
  getActivePlan: () => ipcRenderer.invoke('get-active-plan'),
  getTelemetry: () => ipcRenderer.invoke('get-telemetry'),
  onTelemetryUpdated: (callback: (telemetry: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('telemetry-updated', handler);
    return () => ipcRenderer.removeListener('telemetry-updated', handler);
  },
  clearAuditHistory: () => ipcRenderer.send('clear-audit-history'),
  onAuditHistoryUpdated: (callback: (records: any[]) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('audit-history-updated', handler);
    return () => ipcRenderer.removeListener('audit-history-updated', handler);
  },
  focusWindow: (pid?: number, nameHint?: string, cwdHint?: string) => ipcRenderer.send('focus-window', pid, nameHint, cwdHint),
  abortSession: (sessionId: string, pid?: number) => ipcRenderer.send('abort-session', { sessionId, pid }),
  minimizeOrClose: (action: 'hide' | 'close') => ipcRenderer.send('window-action', action),
  setTargetSession: (sessionId: string | null) => ipcRenderer.send('set-target-session', sessionId),
};

contextBridge.exposeInMainWorld('winvibe', api);

declare global {
  interface Window {
    winvibe: WinVibeAPI;
  }
}
