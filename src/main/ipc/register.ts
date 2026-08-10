import { BrowserWindow } from 'electron';
import { RunProcess } from '../run/run-process';
import { buildArgs } from '../run/args-builder';
import { getWork, markRunStarted, markRunCompleted, listWorks, updateWorkDirect, sessionFileExists } from '../work/work-manager';
import { getProject } from '../project/project-manager';
import { load, save } from '../storage/store';
import { EVENTS } from '../../shared/ipc-channels';
import { RunResult, StreamEvent, Work } from '../../shared/types';
import { registerProjectHandlers } from './handlers/project';
import { registerWorkHandlers, WorkHandlerDeps } from './handlers/work';
import { registerSettingsHandlers } from './handlers/settings';
import { logInfo, logError, logWarn } from '../utils/logger';
import {
  acquireLocalSettings,
  releaseLocalSettings,
  releaseAllLocalSettings,
  restoreLocalSettings,
} from '../claude/claude-config';

const activeRuns = new Map<string, RunProcess>();
let mainWindow: BrowserWindow;

export function registerAllIPC(window: BrowserWindow): void {
  mainWindow = window;

  registerProjectHandlers();
  registerSettingsHandlers();

  const deps: WorkHandlerDeps = {
    spawnRun: (workId: string, prompt: string) => spawnRun(workId, prompt),
    cancelRun: (workId: string) => cancelRun(workId),
  };
  registerWorkHandlers(deps);

  logInfo('IPC handlers registered');
}

/**
 * Stop all active runs. Called before app quit.
 */
export function shutdownAllRuns(): void {
  logInfo(`Shutting down ${activeRuns.size} active run(s)`);
  for (const [workId, rp] of activeRuns) {
    try {
      rp.cancel();
      const work = getWork(workId);
      if (work && work.status === 'IN_PROGRESS') {
        updateWorkDirect(workId, w => {
          w.status = 'AWAITING_INPUT';
          w.currentRunPid = null;
          w.statusNote = 'приложение закрыто';
        });
      }
    } catch (err) {
      logError(`Error cancelling run for work ${workId}`, err);
    }
  }
  activeRuns.clear();
  // Restore every project's original settings.local.json regardless of active count
  releaseAllLocalSettings();
}

/**
 * Recover stale works after an unclean shutdown.
 * Any work with status IN_PROGRESS or non-null currentRunPid gets reset to AWAITING_INPUT.
 */
export function recoverStaleWorks(): void {
  const works = listWorks();
  let recovered = 0;
  const restoredProjects = new Set<string>();

  for (const work of works) {
    if (work.status === 'IN_PROGRESS' || work.currentRunPid !== null) {
      logWarn(`Recovering stale work ${work.id}: status=${work.status}, pid=${work.currentRunPid}`);
      updateWorkDirect(work.id, w => {
        w.status = 'AWAITING_INPUT';
        w.currentRunPid = null;
        w.statusNote = 'восстановлен после перезапуска';
      });
      recovered++;

      // Restore user's settings.local.json if an orphan backup exists
      const project = getProject(work.projectId);
      if (project && !restoredProjects.has(project.path)) {
        restoredProjects.add(project.path);
        try {
          restoreLocalSettings(project.path);
        } catch (err) {
          logError(`Failed to restore local settings for project ${project.id}`, err);
        }
      }
    }
  }

  if (recovered > 0) {
    logInfo(`Recovered ${recovered} stale work(s)`);
  }
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

  // Determine if this is a resume (only if session file exists from previous run)
  const isResume = work.runCount > 0 && sessionFileExists(workId);

  const args = buildArgs(workId, prompt, settings, isResume);

  // Replace user's settings.local.json with our permissions for the duration of this run.
  // Ref-counted: only the first concurrent run backs up, only the last one restores.
  acquireLocalSettings(project.path);

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
        // Guard: if onCompleted was already called (defence in depth — RunProcess
        // also has a completed flag, but this protects against edge cases)
        if (!activeRuns.has(workId)) return;

        const NOTE: Record<RunResult['reason'], string | undefined> = {
          ok: undefined,
          error: 'ошибка',
          timeout: 'таймаут',
          stopped: 'остановлено',
          config: 'wrapper misconfigured',
        };
        if (result.reason === 'config') {
          logError(
            `Run ${workId} failed with exit 127 (command not found) — ` +
            `claude-sm wrapper / environment misconfigured`,
            result.errorDetail
          );
        }
        markRunCompleted(workId, NOTE[result.reason], result.errorDetail);
        activeRuns.delete(workId);
        releaseLocalSettings(project.path);
        mainWindow.webContents.send(EVENTS.RUN_COMPLETED, {
          workId,
          exitCode: result.exitCode,
          reason: result.reason,
          errorDetail: result.errorDetail,
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

  const work = getWork(workId);
  if (work) {
    const project = getProject(work.projectId);
    if (project) {
      releaseLocalSettings(project.path);
    }
  }
}

function sendWorkUpdate(workId: string): void {
  const work = getWork(workId);
  if (work) {
    mainWindow.webContents.send(EVENTS.WORK_UPDATED, { work });
  }
}
