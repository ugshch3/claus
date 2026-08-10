// Константы имён IPC-каналов

// Команды (Renderer → Main)
export const IPC = {
  // Projects
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_DELETE: 'project:delete',
  PROJECT_CHECK_DIRTY: 'project:check-dirty',
  PROJECT_DISCARD: 'project:discard',
  PROJECT_CHECK_BRANCH: 'project:check-branch',

  // Works
  WORK_LIST: 'work:list',
  WORK_GET: 'work:get',
  WORK_CREATE: 'work:create',
  WORK_DELETE: 'work:delete',
  WORK_COMPLETE: 'work:complete',
  WORK_RESPOND: 'work:respond',
  WORK_CANCEL: 'work:cancel',
  WORK_RESTART_RUN: 'work:restart-run',
  WORK_RENAME: 'work:rename',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
} as const;

// События (Main → Renderer)
export const EVENTS = {
  RUN_EVENT: 'run:event',
  RUN_STARTED: 'run:started',
  RUN_COMPLETED: 'run:completed',
  WORK_UPDATED: 'work:updated',
} as const;
