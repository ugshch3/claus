import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../shared/types';
import { load, save } from '../storage/store';
import { Profile } from '../claude/claude-config';

export function createProject(params: {
  name: string;
  path: string;
  profile?: Profile;
}): Project {
  const data = load();

  // Resolve ~ and relative paths to absolute
  const resolvedPath = resolvePath(params.path);

  // Check path uniqueness (compare resolved paths)
  if (data.projects.some(p => resolvePath(p.path) === resolvedPath)) {
    throw new Error(`Проект с путём '${params.path}' уже существует`);
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: params.name,
    path: resolvedPath,
    slug: slugifyPath(resolvedPath),
    profile: params.profile || 'generic',
    createdAt: new Date().toISOString(),
  };

  data.projects.push(project);
  save(data);
  return project;
}

export function listProjects(): Project[] {
  return load().projects;
}

/** Find a project whose resolved path matches the given rawPath. */
export function findProjectByPath(rawPath: string): Project | undefined {
  const data = load();
  const resolvedPath = resolvePath(rawPath);
  return data.projects.find(p => resolvePath(p.path) === resolvedPath);
}

/** Generate a unique project name. If baseName is taken, append -1, -2, ... */
export function generateUniqueName(baseName: string): string {
  const data = load();
  const names = new Set(data.projects.map(p => p.name));
  if (!names.has(baseName)) return baseName;
  let i = 1;
  while (names.has(`${baseName}-${i}`)) {
    i++;
  }
  return `${baseName}-${i}`;
}

export function getProject(id: string): Project | undefined {
  return load().projects.find(p => p.id === id);
}

export function deleteProject(id: string): void {
  const data = load();
  const idx = data.projects.findIndex(p => p.id === id);
  if (idx === -1) {
    throw new Error(`Проект с id '${id}' не найден`);
  }

  // Check if any active works exist for this project
  const hasActiveWorks = data.works.some(
    w => w.projectId === id && w.status !== 'COMPLETED'
  );
  if (hasActiveWorks) {
    throw new Error(
      'Нельзя удалить проект с активными Work. Завершите или удалите их сначала.'
    );
  }

  data.projects.splice(idx, 1);
  save(data);
}

/**
 * Slugify path like Claude Code does: replace all non-alphanumeric
 * characters (except path separators) with '-'.
 * /Users/me/my-app → -Users-me-my-app
 */
function slugifyPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function resolvePath(rawPath: string): string {
  if (rawPath.startsWith('~')) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  return path.resolve(rawPath);
}
