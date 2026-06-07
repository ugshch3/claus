import { ipcMain } from 'electron';
import {
  createWork, listWorks, getWork, getLastResult,
  completeWork, deleteWork, markRunStarted, markRunCompleted,
} from '../../work/work-manager';
import { getProject } from '../../project/project-manager';
import { IPC } from '../../../shared/ipc-channels';

// These will be set by register.ts
export interface WorkHandlerDeps {
  spawnRun: (workId: string, prompt: string) => void;
  cancelRun: (workId: string) => void;
}

let deps: WorkHandlerDeps;

export function registerWorkHandlers(d: WorkHandlerDeps): void {
  deps = d;

  ipcMain.handle(IPC.WORK_LIST, async (_event, { projectId }: { projectId?: string }) => {
    return listWorks(projectId);
  });

  ipcMain.handle(IPC.WORK_GET, async (_event, { id }: { id: string }) => {
    const work = getWork(id);
    if (!work) throw new Error(`Work с id '${id}' не найден`);
    const lastResult = getLastResult(id);
    return { work, lastResult };
  });

  ipcMain.handle(
    IPC.WORK_CREATE,
    async (
      _event,
      params: { projectId: string; description: string }
    ) => {
      const work = createWork(params);
      // Spawn the first run with the work description
      deps.spawnRun(work.id, work.description);
      return work;
    }
  );

  ipcMain.handle(IPC.WORK_DELETE, async (_event, { id }: { id: string }) => {
    deps.cancelRun(id);
    deleteWork(id);
  });

  ipcMain.handle(IPC.WORK_COMPLETE, async (_event, { id }: { id: string }) => {
    completeWork(id);
  });

  ipcMain.handle(
    IPC.WORK_RESPOND,
    async (_event, { id, message }: { id: string; message: string }) => {
      const work = getWork(id);
      if (!work) throw new Error(`Work с id '${id}' не найден`);

      markRunStarted(id, 0); // PID will be updated by spawnRun
      deps.spawnRun(id, message);  // use user's response as prompt
    }
  );

  ipcMain.handle(IPC.WORK_CANCEL, async (_event, { id }: { id: string }) => {
    deps.cancelRun(id);
    markRunCompleted(id, 'остановлено пользователем');
  });

  ipcMain.handle(IPC.WORK_RESTART_RUN, async (_event, { id }: { id: string }) => {
    const work = getWork(id);
    if (!work) throw new Error(`Work с id '${id}' не найден`);

    deps.spawnRun(id, work.description);  // re-use original description
  });
}
