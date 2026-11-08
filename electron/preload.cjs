const { contextBridge, ipcRenderer } = require('electron');

const api = {
  setIgnoreMouseEvents: (ignore, forward) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, forward);
  },
  setWindowExpanded: (expanded) => {
    ipcRenderer.send('set-window-expanded', expanded);
  },
  onAutoCollapse: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('auto-collapse', handler);
    return () => {
      ipcRenderer.removeListener('auto-collapse', handler);
    };
  },
  sendDecision: (requestId, action, selectedOption) => {
    ipcRenderer.send('decision-response', { requestId, action, selectedOption });
  },
  onDecisionRequest: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('decision-request', handler);
    return () => {
      ipcRenderer.removeListener('decision-request', handler);
    };
  },
  onAgentEvent: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('agent-event', handler);
    return () => {
      ipcRenderer.removeListener('agent-event', handler);
    };
  },
  onActiveAgentsSync: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('active-agents-sync', handler);
    return () => {
      ipcRenderer.removeListener('active-agents-sync', handler);
    };
  },
  onDecisionResolved: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('decision-resolved', handler);
    return () => {
      ipcRenderer.removeListener('decision-resolved', handler);
    };
  },
  onToggleExpand: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-expand', handler);
    return () => {
      ipcRenderer.removeListener('toggle-expand', handler);
    };
  },
  onToggleMute: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-mute', handler);
    return () => {
      ipcRenderer.removeListener('toggle-mute', handler);
    };
  },
  onDndToggle: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('dnd-toggle', handler);
    return () => {
      ipcRenderer.removeListener('dnd-toggle', handler);
    };
  },
  onShortcutDecision: (callback) => {
    const handler = (_, action) => callback(action);
    ipcRenderer.on('shortcut-decision', handler);
    return () => {
      ipcRenderer.removeListener('shortcut-decision', handler);
    };
  },
  onAgentQuickFeedback: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('agent-quick-feedback', handler);
    return () => {
      ipcRenderer.removeListener('agent-quick-feedback', handler);
    };
  },
  getAuditHistory: () => {
    return ipcRenderer.invoke('get-audit-history');
  },
  getActivePlan: () => {
    return ipcRenderer.invoke('get-active-plan');
  },
  getTelemetry: () => {
    return ipcRenderer.invoke('get-telemetry');
  },
  onTelemetryUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('telemetry-updated', handler);
    return () => {
      ipcRenderer.removeListener('telemetry-updated', handler);
    };
  },
  clearAuditHistory: () => {
    ipcRenderer.send('clear-audit-history');
  },
  onAuditHistoryUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('audit-history-updated', handler);
    return () => {
      ipcRenderer.removeListener('audit-history-updated', handler);
    };
  },
  focusWindow: (pid, nameHint, cwdHint) => {
    ipcRenderer.send('focus-window', pid, nameHint, cwdHint);
  },
  abortSession: (sessionId, pid) => {
    ipcRenderer.send('abort-session', { sessionId, pid });
  },
  minimizeOrClose: (action) => {
    ipcRenderer.send('window-action', action);
  },
  setTargetSession: (sessionId) => {
    ipcRenderer.send('set-target-session', sessionId);
  }
};

contextBridge.exposeInMainWorld('winvibe', api);
