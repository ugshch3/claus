// Типизированная обёртка над window.electronAPI
// Единственное место в renderer, где вызывается window.electronAPI.*

import { Project, Work, Settings, StreamEvent, RunResult, HistoryEntry, ModelChoice } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface ElectronAPI {
  projectList(): Promise<Project[]>;
  projectGet(id: string): Promise<Project>;
  projectCreate(params: { name: string; path: string; profile?: string }): Promise<Project>;
  projectDelete(id: string): Promise<void>;
  projectCheckDirty(id: string): Promise<{ isDirty: boolean; files: string[] }>;
  projectDiscard(id: string): Promise<void>;
  projectCheckBranch(id: string, branchName: string): Promise<{ exists: boolean }>;

  workList(projectId?: string): Promise<Work[]>;
  workGet(id: string): Promise<{ work: Work; lastResult: string | null }>;
  workCreate(params: { projectId?: string; name?: string; description: string; directory?: string; model?: ModelChoice; modelCustom?: string }): Promise<Work>;
  workDelete(id: string): Promise<void>;
  workComplete(id: string): Promise<void>;
  workRespond(id: string, message: string): Promise<void>;
  workCancel(id: string): Promise<void>;
  workRestartRun(id: string): Promise<void>;
  workRename(id: string, name: string): Promise<void>;
  workHistory(id: string): Promise<{ messages: HistoryEntry[] }>;
  workSetModel(id: string, model: ModelChoice, modelCustom?: string): Promise<void>;
  workMoveToBottom(id: string): Promise<void>;

  settingsGet(): Promise<Settings>;
  settingsUpdate(params: Partial<Settings>): Promise<Settings>;

  onRunEvent(callback: (data: { workId: string; event: StreamEvent }) => void): void;
  onRunStarted(callback: (data: { workId: string }) => void): void;
  onRunCompleted(callback: (data: { workId: string; exitCode: number; reason: string; errorDetail?: string }) => void): void;
  onWorkUpdated(callback: (data: { work: Work }) => void): void;
}

export const api: ElectronAPI = window.electronAPI;
