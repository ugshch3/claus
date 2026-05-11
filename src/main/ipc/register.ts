import { BrowserWindow } from 'electron';
import { RunProcess } from '../run/run-process';
import { buildArgs } from '../run/args-builder';
import { getWork, markRunStarted, markRunCompleted } from '../work/work-manager';
import { getProject } from '../project/project-manager';
import { load } from '../storage/store';
import { EVENTS } from '../../shared/ipc-channels';
import { RunResult, StreamEvent, Work } from '../../shared/types';
import { registerProjectHandlers } from './handlers/project';
import { registerWorkHandlers, WorkHandlerDeps } from './handlers/work';
import { registerSettingsHandlers } from './handlers/settings';

const activeRuns = new Map<string, RunProcess>();
let mainWindow: BrowserWindow;

export function registerAllIPC(window: BrowserWindow): void {
  mainWindow = window;

  // Register handlers
  registerProjectHandlers();

  registerSettingsHandlers();

  const deps: WorkHandlerDeps = {
    spawnRun: (workId: string, prompt: string) => spawnRun(workId, prompt),
    cancelRun: (workId: string) => cancelRun(workId),
  };
  registerWorkHandlers(deps);
}

// ---- Run management ----

function spawnRun(workId: string, prompt: string): void {
  const work = getWork(workId);
  if (!work) throw new Error(`Work с id '${workId}' не найден`);

  const project = getProject(work.projectId);
  if (!project) throw new Error(`Проект для Work '${workId}' не найден`);

  const settings = load().settings;

  // Cancel existing run if any
  if (activeRuns.has(workId)) {
    activeRuns.get(workId)!.cancel();
    activeRuns.delete(workId);
  }

  // Determine if this is a resume
  const isResume = work.runCount > 0;

  const args = buildArgs(workId, prompt, settings, isResume);

  const rp = new RunProcess(
    {
      onStarted: (sessionId: string) => {
        markRunStarted(workId, rp.getPid()!);
        mainWindow.webContents.send(EVENTS.RUN_STARTED, { workId });
        sendWorkUpdate(workId);
      },
      onEvent: (sessionId: string, event: StreamEvent) => {
        mainWindow.webContents.send(EVENTS.RUN_EVENT, { workId, event });
      },
      onCompleted: (sessionId: string, result: RunResult) => {
        markRunCompleted(workId, result.reason);
        activeRuns.delete(workId);
        mainWindow.webContents.send(EVENTS.RUN_COMPLETED, {
          workId,
          exitCode: result.exitCode,
          reason: result.reason,
        });
        sendWorkUpdate(workId);
      },
    },
    workId
  );

  rp.spawn(project.path, args, settings.watchdogTimeoutMinutes);
  activeRuns.set(workId, rp);
}

function cancelRun(workId: string): void {
  const rp = activeRuns.get(workId);
  if (rp && rp.isRunning()) {
    rp.cancel();
  }
  activeRuns.delete(workId);
}

function sendWorkUpdate(workId: string): void {
  const work = getWork(workId);
  if (work) {
    mainWindow.webContents.send(EVENTS.WORK_UPDATED, { work });
  }
}
