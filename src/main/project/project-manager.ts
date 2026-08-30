import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../shared/types';
import { load, save } from '../storage/store';
import { Profile, isProtectedConfigPath } from '../claude/claude-config';
import { initRepo } from '../git/git-service';

export function createProject(params: {
  name: string;
  path: string;
  profile?: Profile;
  initRepo?: boolean;
}): Project {
  const data = load();

  // Resolve ~ and relative paths to absolute
  const resolvedPath = resolvePath(params.path);

  // $HOME and / are not projects: their .claude is the global Claude Code
  // config, and generating project settings there wipes the user's own
  // permissions and installs a relative-path hook globally.
  if (isProtectedConfigPath(resolvedPath)) {
    throw new Error(
      `Нельзя добавить '${resolvedPath}' как проект: это домашняя директория ` +
      `(её .claude — глобальный конфиг Claude Code). Выберите конкретный репозиторий.`
    );
  }

  // Handle git init before project creation
  if (params.initRepo) {
    ensureDirectoryForInit(resolvedPath);
  }

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

/**
 * Ensure directory exists and run git init if not already a repo.
 * Called only when initRepo flag is set.
 */
function ensureDirectoryForInit(resolvedPath: string): void {
  // Check if path points to a file
  if (fs.existsSync(resolvedPath) && !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Путь указывает на файл, а не директорию: ${resolvedPath}`);
  }

  // Create directory if it doesn't exist
  if (!fs.existsSync(resolvedPath)) {
    try {
      fs.mkdirSync(resolvedPath, { recursive: true });
    } catch (err: any) {
      throw new Error(`Не удалось создать директорию '${resolvedPath}': ${err.message}`);
    }
  }

  // Skip init if already a git repository
  if (fs.existsSync(path.join(resolvedPath, '.git'))) {
    return;
  }

  initRepo(resolvedPath);
}
