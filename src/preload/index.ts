import { contextBridge, ipcRenderer } from 'electron';

// Заглушка — будет расширена в Фазе 5
contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  projectList: () => ipcRenderer.invoke('project:list'),
  projectGet: (id: string) => ipcRenderer.invoke('project:get', { id }),
  projectCreate: (params: any) => ipcRenderer.invoke('project:create', params),
  projectDelete: (id: string) => ipcRenderer.invoke('project:delete', { id }),
  projectCheckDirty: (id: string) => ipcRenderer.invoke('project:check-dirty', { id }),
  projectDiscard: (id: string) => ipcRenderer.invoke('project:discard', { id }),
  projectCheckBranch: (id: string, branchName: string) =>
    ipcRenderer.invoke('project:check-branch', { id, branchName }),

  // Works
  workList: (projectId?: string) => ipcRenderer.invoke('work:list', { projectId }),
  workGet: (id: string) => ipcRenderer.invoke('work:get', { id }),
  workCreate: (params: any) => ipcRenderer.invoke('work:create', params),
  workDelete: (id: string) => ipcRenderer.invoke('work:delete', { id }),
  workComplete: (id: string) => ipcRenderer.invoke('work:complete', { id }),
  workRespond: (id: string, message: string) =>
    ipcRenderer.invoke('work:respond', { id, message }),
  workCancel: (id: string) => ipcRenderer.invoke('work:cancel', { id }),
  workRestartRun: (id: string) => ipcRenderer.invoke('work:restart-run', { id }),
  workRename: (id: string, name: string) =>
    ipcRenderer.invoke('work:rename', { id, name }),
  workHistory: (id: string) =>
    ipcRenderer.invoke('work:history', { id }),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (params: any) => ipcRenderer.invoke('settings:update', params),

  // Events (Main → Renderer)
  onRunEvent: (callback: (data: any) => void) => {
    ipcRenderer.on('run:event', (_event, data) => callback(data));
  },
  onRunStarted: (callback: (data: any) => void) => {
    ipcRenderer.on('run:started', (_event, data) => callback(data));
  },
  onRunCompleted: (callback: (data: any) => void) => {
    ipcRenderer.on('run:completed', (_event, data) => callback(data));
  },
  onWorkUpdated: (callback: (data: any) => void) => {
    ipcRenderer.on('work:updated', (_event, data) => callback(data));
  },
});
