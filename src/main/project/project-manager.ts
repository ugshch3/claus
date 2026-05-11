import * as crypto from 'crypto';
import { Project } from '../../shared/types';
import { load, save } from '../storage/store';
import { Profile } from '../claude/claude-config';

export function createProject(params: {
  name: string;
  path: string;
  profile?: Profile;
}): Project {
  const data = load();

  // Check path uniqueness
  if (data.projects.some(p => p.path === params.path)) {
    throw new Error(`Проект с путём '${params.path}' уже существует`);
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: params.name,
    path: params.path,
    slug: slugifyPath(params.path),
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
