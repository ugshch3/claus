// Общие типы для Main Process и Preload

export interface Project {
  id: string;           // UUID
  name: string;
  path: string;
  slug: string;
  profile: 'android' | 'frontend' | 'python' | 'generic';
  createdAt: string;    // ISO 8601
}

export interface Work {
  id: string;            // session_id UUID
  projectId: string;
  description: string;
  branch: string;
  status: 'IN_PROGRESS' | 'AWAITING_INPUT' | 'COMPLETED';
  statusNote?: string;   // пометка: «бюджет», «ошибка», «остановлено»
  currentRunPid: number | null;
  runCount: number;
  lastActiveAt: string;  // ISO 8601
  createdAt: string;
  completedAt: string | null;
}

export interface Settings {
  watchdogTimeoutMinutes: number;
  defaultMaxTurns: number;
  defaultProfile: string;
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface AppData {
  version: number;
  projects: Project[];
  works: Work[];
  settings: Settings;
}

export type RunReason = 'ok' | 'error' | 'timeout' | 'stopped';

export interface RunResult {
  exitCode: number;
  reason: RunReason;
}
