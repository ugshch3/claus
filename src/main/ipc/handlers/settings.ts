import { ipcMain } from 'electron';
import { load, save } from '../../storage/store';
import { Settings } from '../../../shared/types';
import { IPC } from '../../../shared/ipc-channels';
import { sync as syncClaudeConfig, Profile } from '../../claude/claude-config';
import { listProjects } from '../../project/project-manager';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return load().settings;
  });

  ipcMain.handle(
    IPC.SETTINGS_UPDATE,
    async (_event, params: Partial<Settings>) => {
      const data = load();
      const oldProfile = data.settings.defaultProfile;
      data.settings = { ...data.settings, ...params };
      save(data);

      // If profile changed, re-sync .claude config for all projects
      if (params.defaultProfile && params.defaultProfile !== oldProfile) {
        const projects = listProjects();
        for (const project of projects) {
          try {
            syncClaudeConfig(project.path, params.defaultProfile as Profile);
          } catch (err) {
            console.error(`Failed to sync claude config for project ${project.id}:`, err);
          }
        }
      }

      return data.settings;
    }
  );
}
