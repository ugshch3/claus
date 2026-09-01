import * as crypto from 'crypto';
import { Work, HistoryEntry, ModelChoice } from '../../shared/types';
import { load, save } from '../storage/store';
import {
  getProject,
  findProjectByPath,
  generateUniqueName,
  createProject,
} from '../project/project-manager';
import { getCurrentBranch } from '../git/git-service';
import { sync as syncClaudeConfig } from '../claude/claude-config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---- Public API ----

export function createWork(params: {
  projectId?: string;
  name?: string;
  description: string;
  directory?: string;
  model?: ModelChoice;
  modelCustom?: string;
}): Work {
  let projectId = params.projectId;

  // If directory is provided, find or auto-create the project
  if (params.directory) {
    const resolvedDir = resolveDir(params.directory);
    if (!fs.existsSync(resolvedDir)) {
      throw new Error(`Directory not found: ${params.directory}`);
    }

    let project = findProjectByPath(params.directory);
    if (!project) {
      const name = path.basename(resolvedDir);
      const uniqueName = generateUniqueName(name);
      project = createProject({ name: uniqueName, path: resolvedDir, profile: 'generic' });
      // Set up Claude Code permissions for the new project
      syncClaudeConfig(project.path, 'generic');
    }
    projectId = project.id;
  }

  if (!projectId) {
    throw new Error('projectId or directory is required');
  }

  // Reload data — createProject may have modified the store
  const data = load();

  // Validate project exists
  const project = data.projects.find(p => p.id === projectId);
  if (!project) {
    throw new Error(`Проект с id '${projectId}' не найден`);
  }

  // Record current branch (Claude Code decides whether to switch)
  let currentBranch = '';
  try {
    currentBranch = getCurrentBranch(project.path);
  } catch {
    // Not a git repo — leave empty; git checks are skipped downstream
  }

  // Create work
  const now = new Date().toISOString();
  const work: Work = {
    id: crypto.randomUUID(),
    projectId,
    name: params.name || undefined,
    description: params.description,
    branch: currentBranch,
    status: 'IN_PROGRESS',
    currentRunPid: null,
    runCount: 0,
    lastActiveAt: now,
    createdAt: now,
    completedAt: null,
    model: params.model,
    modelCustom: params.modelCustom,
  };

  data.works.push(work);
  save(data);
  return work;
}

export function listWorks(projectId?: string): Work[] {
  const works = load().works;
  if (projectId) {
    return works.filter(w => w.projectId === projectId);
  }
  return works;
}

export function getWork(id: string): Work | undefined {
  return load().works.find(w => w.id === id);
}

export function getLastResult(workId: string): string | null {
  const work = getWork(workId);
  if (!work) return null;

  const project = getProject(work.projectId);
  if (!project) return null;

  // Read the last result from the session JSONL file
  const resolvedPath = project.path.startsWith('~')
    ? path.join(os.homedir(), project.path.slice(1))
    : project.path;
  const slug = slugifyPath(resolvedPath);
  const jsonlPath = path.join(
    os.homedir(), '.claude', 'projects', slug, `${work.id}.jsonl`
  );

  try {
    if (!fs.existsSync(jsonlPath)) return null;
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return null;

    // Walk backwards to find the last result
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'result') {
        if (entry.result) {
          return String(entry.result);
        }
      }
      if (entry.type === 'assistant') {
        if (entry.message?.content) {
          if (Array.isArray(entry.message.content)) {
            const textParts = entry.message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text);
            if (textParts.length > 0) {
              return textParts.join('\n');
            }
          } else {
            return String(entry.message.content);
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function sessionFileExists(workId: string): boolean {
  const work = getWork(workId);
  if (!work) return false;

  const project = getProject(work.projectId);
  if (!project) return false;

  const resolvedPath = project.path.startsWith('~')
    ? path.join(os.homedir(), project.path.slice(1))
    : project.path;
  const slug = slugifyPath(resolvedPath);
  const jsonlPath = path.join(
    os.homedir(), '.claude', 'projects', slug, `${work.id}.jsonl`
  );

  return fs.existsSync(jsonlPath);
}

export function getFullHistory(workId: string): HistoryEntry[] {
  const work = getWork(workId);
  if (!work) return [];

  const project = getProject(work.projectId);
  if (!project) return [];

  const resolvedPath = project.path.startsWith('~')
    ? path.join(os.homedir(), project.path.slice(1))
    : project.path;
  const slug = slugifyPath(resolvedPath);
  const jsonlPath = path.join(
    os.homedir(), '.claude', 'projects', slug, `${work.id}.jsonl`
  );

  try {
    if (!fs.existsSync(jsonlPath)) return [];
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return [];

    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Malformed JSON line — skip with warning
        console.warn(`[work-manager] Skipping malformed JSONL line for work ${workId}`);
      }
    }
    return entries;
  } catch (err) {
    console.error(`[work-manager] Failed to read history for work ${workId}:`, err);
    return [];
  }
}

export function markRunStarted(workId: string, pid: number): void {
  updateWork(workId, work => {
    work.status = 'IN_PROGRESS';
    work.currentRunPid = pid;
    work.lastActiveAt = new Date().toISOString();
    delete work.lastError;   // clear stale failure from a previous run
  });
}

export function markRunCompleted(
  workId: string,
  statusNote?: string,
  errorDetail?: string
): void {
  updateWork(workId, work => {
    work.status = 'AWAITING_INPUT';
    work.currentRunPid = null;
    work.runCount += 1;
    work.lastActiveAt = new Date().toISOString();
    if (statusNote) {
      work.statusNote = statusNote;
    } else {
      delete work.statusNote;
    }
    if (errorDetail) {
      work.lastError = errorDetail;
    } else {
      delete work.lastError;
    }
  });
}

export function completeWork(workId: string): void {
  updateWork(workId, work => {
    work.status = 'COMPLETED';
    work.currentRunPid = null;
    work.completedAt = new Date().toISOString();
    work.lastActiveAt = new Date().toISOString();
  });
}

export function renameWork(workId: string, name: string): void {
  updateWork(workId, work => {
    work.name = name;
  });
}

export function setWorkModel(workId: string, model: ModelChoice, modelCustom?: string): void {
  updateWork(workId, work => {
    work.model = model;
    work.modelCustom = modelCustom;
  });
}

export function moveWorkToBottom(workId: string): void {
  const data = load();
  const idx = data.works.findIndex(w => w.id === workId);
  if (idx === -1) {
    throw new Error(`Work с id '${workId}' не найден`);
  }

  const [work] = data.works.splice(idx, 1);
  data.works.push(work);
  save(data);
}

export function deleteWork(workId: string): void {
  const data = load();
  const idx = data.works.findIndex(w => w.id === workId);
  if (idx === -1) {
    throw new Error(`Work с id '${workId}' не найден`);
  }

  const work = data.works[idx];

  // Kill running process if any
  if (work.currentRunPid) {
    try {
      process.kill(work.currentRunPid, 'SIGTERM');
    } catch {
      // Process may already be dead — ignore
    }
  }

  // Delete JSONL session file
  const project = data.projects.find(p => p.id === work.projectId);
  if (project) {
    const resolvedPath = project.path.startsWith('~')
      ? path.join(os.homedir(), project.path.slice(1))
      : project.path;
    const slug = slugifyPath(resolvedPath);
    const jsonlPath = path.join(
      os.homedir(), '.claude', 'projects', slug, `${work.id}.jsonl`
    );
    try {
      if (fs.existsSync(jsonlPath)) {
        fs.unlinkSync(jsonlPath);
      }
    } catch {
      // May not exist — ignore
    }
  }

  data.works.splice(idx, 1);
  save(data);
}

// ---- Internal helpers ----

export function updateWorkDirect(
  workId: string,
  updater: (work: Work) => void
): void {
  updateWork(workId, updater);
}

function updateWork(
  workId: string,
  updater: (work: Work) => void
): void {
  const data = load();
  const work = data.works.find(w => w.id === workId);
  if (!work) {
    throw new Error(`Work с id '${workId}' не найден`);
  }
  updater(work);
  save(data);
}

function slugifyPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function resolveDir(rawPath: string): string {
  if (rawPath.startsWith('~')) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  return path.resolve(rawPath);
}
