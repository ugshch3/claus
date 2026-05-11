import * as crypto from 'crypto';
import { Work } from '../../shared/types';
import { load, save } from '../storage/store';
import { getProject } from '../project/project-manager';
import { isDirty, branchExists, createBranch, checkout, getDefaultBranch, DirtyRepoError, BranchExistsError } from '../git/git-service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---- Public API ----

export function createWork(params: {
  projectId: string;
  description: string;
  branchName: string;
}): Work {
  const data = load();

  // Validate project exists
  const project = data.projects.find(p => p.id === params.projectId);
  if (!project) {
    throw new Error(`Проект с id '${params.projectId}' не найден`);
  }

  // Check dirty repo
  const dirty = isDirty(project.path);
  if (dirty.isDirty) {
    throw new DirtyRepoError(dirty.files);
  }

  // Check branch name conflict (local only)
  if (branchExists(project.path, params.branchName)) {
    throw new BranchExistsError(params.branchName);
  }

  // Check no active run in this project
  const activeRun = data.works.some(
    w => w.projectId === params.projectId && w.status === 'IN_PROGRESS'
  );
  if (activeRun) {
    throw new Error('В проекте уже есть выполняющийся Work');
  }

  // Create branch from default
  const baseBranch = getDefaultBranch(project.path);
  createBranch(project.path, params.branchName, baseBranch);

  // Create work
  const now = new Date().toISOString();
  const work: Work = {
    id: crypto.randomUUID(),
    projectId: params.projectId,
    description: params.description,
    branch: params.branchName,
    status: 'IN_PROGRESS',
    currentRunPid: null,
    runCount: 0,
    lastActiveAt: now,
    createdAt: now,
    completedAt: null,
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
  const slug = slugifyPath(project.path);
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
      if (entry.type === 'result' || entry.type === 'assistant') {
        if (entry.message?.content) {
          if (Array.isArray(entry.message.content)) {
            const textParts = entry.message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text);
            return textParts.join('\n');
          }
          return String(entry.message.content);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function markRunStarted(workId: string, pid: number): void {
  updateWork(workId, work => {
    work.status = 'IN_PROGRESS';
    work.currentRunPid = pid;
    work.lastActiveAt = new Date().toISOString();
  });
}

export function markRunCompleted(workId: string, statusNote?: string): void {
  updateWork(workId, work => {
    work.status = 'AWAITING_INPUT';
    work.currentRunPid = null;
    work.runCount += 1;
    work.lastActiveAt = new Date().toISOString();
    if (statusNote) {
      work.statusNote = statusNote;
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
    const slug = slugifyPath(project.path);
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

// Ensure work's branch is checked out before a run
export function ensureBranch(workId: string): void {
  const work = getWork(workId);
  if (!work) throw new Error(`Work с id '${workId}' не найден`);

  const project = getProject(work.projectId);
  if (!project) throw new Error(`Проект не найден`);

  checkout(project.path, work.branch);
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
