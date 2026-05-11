import { ipcMain } from 'electron';
import { load, save } from '../../storage/store';
import { Settings } from '../../../shared/types';
import { IPC } from '../../../shared/ipc-channels';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return load().settings;
  });

  ipcMain.handle(
    IPC.SETTINGS_UPDATE,
    async (_event, params: Partial<Settings>) => {
      const data = load();
      data.settings = { ...data.settings, ...params };
      save(data);
      return data.settings;
    }
  );
}
