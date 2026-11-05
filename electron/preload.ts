import { contextBridge, ipcRenderer } from 'electron';

export interface WinVibeAPI {
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void;
  sendDecision: (requestId: string, action: 'allow' | 'deny' | 'ask') => void;
  onDecisionRequest: (callback: (request: any) => void) => () => void;
  onAgentEvent: (callback: (event: any) => void) => () => void;
  focusWindow: (pid: number) => void;
  minimizeOrClose: (action: 'hide' | 'close') => void;
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
    return () => {
      ipcRenderer.removeListener('decision-request', handler);
    };
  },
  onAgentEvent: (callback: (event: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('agent-event', handler);
    return () => {
      ipcRenderer.removeListener('agent-event', handler);
    };
  },
  focusWindow: (pid: number) => {
    ipcRenderer.send('focus-window', pid);
  },
  minimizeOrClose: (action: 'hide' | 'close') => {
    ipcRenderer.send('window-action', action);
  }
};

contextBridge.exposeInMainWorld('winvibe', api);

declare global {
  interface Window {
    winvibe: WinVibeAPI;
  }
}
