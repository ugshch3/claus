import { ipcMain } from 'electron';
import {
  listProjects, getProject, createProject, deleteProject,
} from '../../project/project-manager';
import { isDirty, discardChanges, branchExists } from '../../git/git-service';
import { ensure as ensureClaudeConfig } from '../../claude/claude-config';
import { Profile } from '../../claude/claude-config';
import { IPC } from '../../../shared/ipc-channels';

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    return listProjects();
  });

  ipcMain.handle(IPC.PROJECT_GET, async (_event, { id }: { id: string }) => {
    const project = getProject(id);
    if (!project) throw new Error(`Проект с id '${id}' не найден`);
    return project;
  });

  ipcMain.handle(
    IPC.PROJECT_CREATE,
    async (_event, params: { name: string; path: string; profile?: Profile }) => {
      const project = createProject(params);
      // Set up Claude Code config for the project
      ensureClaudeConfig(project.path, project.profile);
      return project;
    }
  );

  ipcMain.handle(IPC.PROJECT_DELETE, async (_event, { id }: { id: string }) => {
    deleteProject(id);
  });

  ipcMain.handle(
    IPC.PROJECT_CHECK_DIRTY,
    async (_event, { id }: { id: string }) => {
      const project = getProject(id);
      if (!project) throw new Error(`Проект с id '${id}' не найден`);
      return isDirty(project.path);
    }
  );

  ipcMain.handle(
    IPC.PROJECT_DISCARD,
    async (_event, { id }: { id: string }) => {
      const project = getProject(id);
      if (!project) throw new Error(`Проект с id '${id}' не найден`);
      discardChanges(project.path);
    }
  );

  ipcMain.handle(
    IPC.PROJECT_CHECK_BRANCH,
    async (_event, { id, branchName }: { id: string; branchName: string }) => {
      const project = getProject(id);
      if (!project) throw new Error(`Проект с id '${id}' не найден`);
      return { exists: branchExists(project.path, branchName) };
    }
  );
}
