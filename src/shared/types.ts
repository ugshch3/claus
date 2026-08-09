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
  lastError?: string;    // диагностика упавшего Run (хвост stderr) — показывается в UI
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
  customPromptFragment: string;
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

// 'config' — обёртка/окружение сломаны (напр. claude-sm вышел с кодом 127,
// command not found). Отличаем от обычной ошибки Claude, чтобы дать понятный статус.
export type RunReason = 'ok' | 'error' | 'timeout' | 'stopped' | 'config';

export interface RunResult {
  exitCode: number;
  reason: RunReason;
  errorDetail?: string;  // хвост stderr для reason 'error' | 'config' | 'timeout'
}
