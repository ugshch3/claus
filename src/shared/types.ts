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
  name?: string;         // user-defined short name; falls back to description if unset
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

/**
 * Как запускать Claude Code:
 * 'claude'    — обычный CLI из PATH (окружение настраивать не нужно);
 * 'claude-sm' — shell-враппер ~/.local/bin/claude-sm (сорсит shell-snapshot);
 * 'custom'    — произвольная команда или абсолютный путь из claudeCommandCustom.
 */
export type ClaudeCommandMode = 'claude' | 'claude-sm' | 'custom';

export interface Settings {
  watchdogTimeoutMinutes: number;
  defaultMaxTurns: number;
  defaultProfile: string;
  customPromptFragment: string;
  uiMode: 'classic' | 'new';
  claudeCommandMode: ClaudeCommandMode;
  claudeCommandCustom: string;   // используется только при claudeCommandMode === 'custom'
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

/** Одно сообщение из JSONL-истории сессии (user/assistant/result/system) */
export interface HistoryEntry {
  type: string;
  [key: string]: any;
}

export interface AppData {
  version: number;
  projects: Project[];
  works: Work[];
  settings: Settings;
}

// 'config' — команда запуска не найдена или окружение сломано (ENOENT при spawn,
// либо выход с кодом 127 из shell-враппера). Отличаем от обычной ошибки Claude,
// чтобы дать понятный статус.
export type RunReason = 'ok' | 'error' | 'timeout' | 'stopped' | 'config';

export interface RunResult {
  exitCode: number;
  reason: RunReason;
  errorDetail?: string;  // хвост stderr для reason 'error' | 'config' | 'timeout'
}
