import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { StreamEvent, RunResult, RunReason } from '../../shared/types';

const LOG_DIR = path.join(os.homedir(), '.claude', 'session-manager-logs');

export interface RunCallbacks {
  onStarted: (sessionId: string) => void;
  onEvent: (sessionId: string, event: StreamEvent) => void;
  onCompleted: (sessionId: string, result: RunResult) => void;
}

export class RunProcess {
  private process: ChildProcess | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private callbacks: RunCallbacks;
  private workId: string;
  private cancelled: boolean = false;

  constructor(callbacks: RunCallbacks, workId: string) {
    this.callbacks = callbacks;
    this.workId = workId;
  }

  /**
   * Spawn claude -p with stream-json output.
   */
  spawn(projectPath: string, args: string[], watchdogTimeoutMinutes: number): void {
    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const logStream = fs.createWriteStream(
      path.join(LOG_DIR, `${this.workId}.log`),
      { flags: 'a' }
    );

    const startTime = Date.now();
    logStream.write(`\n=== Run started at ${new Date().toISOString()} ===\n`);
    logStream.write(`Command: claude ${args.join(' ')}\n\n`);

    // Use claude-sm wrapper (sources shell snapshot + claude-deepseek-v4)
    this.process = spawn('claude-sm', args, {
      cwd: projectPath,
      env: {
        ...process.env,
        CLAUDECODE: '', // allow nested runs from our app
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.cancelled = false;

    // ---- stdout: parse stream-json ----
    const rl = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      logStream.write(`[stdout] ${line}\n`);
      this.resetWatchdog(watchdogTimeoutMinutes);
      try {
        const event: StreamEvent = JSON.parse(line);
        const sessionId = event.session_id || this.workId;
        this.callbacks.onEvent(sessionId, event);
      } catch {
        // Non-JSON line (banner, warning) — ignore
      }
    });

    // ---- stderr: write to log ----
    this.process.stderr!.on('data', (chunk: Buffer) => {
      logStream.write(`[stderr] ${chunk.toString()}`);
    });

    // ---- process exit ----
    this.process.on('exit', (code: number | null) => {
      clearTimeout(this.watchdogTimer!);
      rl.close();
      logStream.write(`\n=== Run exited with code ${code} at ${new Date().toISOString()} ===\n`);
      logStream.end();

      const exitCode = code ?? -1;
      let reason: RunReason;
      if (this.cancelled) {
        reason = 'stopped';
      } else if (exitCode === 0) {
        reason = 'ok';
      } else {
        reason = 'error';
      }

      this.callbacks.onCompleted(this.workId, { exitCode, reason });
      this.process = null;
    });

    // ---- process error ----
    this.process.on('error', (err: Error) => {
      logStream.write(`[error] ${err.message}\n`);
      clearTimeout(this.watchdogTimer!);
      rl.close();
      logStream.end();

      this.callbacks.onCompleted(this.workId, {
        exitCode: -1,
        reason: 'error',
      });
      this.process = null;
    });

    // Start watchdog
    this.resetWatchdog(watchdogTimeoutMinutes);
  }

  /**
   * Cancel the running process.
   */
  cancel(): void {
    this.cancelled = true;
    if (!this.process) return;

    // SIGTERM first
    this.process.kill('SIGTERM');

    // If still alive after 5 seconds, SIGKILL
    setTimeout(() => {
      if (this.process && this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
    }, 5000);
  }

  /**
   * Get the current PID (null if not running).
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Check if the process is currently running.
   */
  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  // ---- Private ----

  private resetWatchdog(minutes: number): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
    }
    if (minutes <= 0) return;

    this.watchdogTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.cancel();
        this.callbacks.onCompleted(this.workId, {
          exitCode: -1,
          reason: 'timeout',
        });
      }
    }, minutes * 60 * 1000);
  }
}
