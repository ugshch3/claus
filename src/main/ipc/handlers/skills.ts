import { ipcMain } from 'electron';
import { scanSkills } from '../../skills/skill-scanner';
import { IPC } from '../../../shared/ipc-channels';

export function registerSkillsHandlers(): void {
  ipcMain.handle(
    IPC.SKILLS_LIST,
    async (_event, { projectPath }: { projectPath?: string }) => {
      return scanSkills(projectPath);
    }
  );
}
