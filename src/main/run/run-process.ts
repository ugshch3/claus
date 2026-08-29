import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { StreamEvent, RunResult, RunReason } from '../../shared/types';
import { buildSpawnPath } from './command';

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
  private awaitingInput: boolean = false;
  private stderrTail: string = '';
  private completed: boolean = false;
  private timeoutOccurred: boolean = false;

  constructor(callbacks: RunCallbacks, workId: string) {
    this.callbacks = callbacks;
    this.workId = workId;
  }

  /**
   * Spawn the Claude CLI with -p and stream-json output.
   * `command` — исполняемый файл из настроек (claude / claude-sm / custom).
   */
  spawn(
    projectPath: string,
    args: string[],
    watchdogTimeoutMinutes: number,
    command: string
  ): void {
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
    logStream.write(`Command: ${command} ${args.join(' ')}\n\n`);

    this.process = spawn(command, args, {
      cwd: projectPath,
      env: {
        ...process.env,
        CLAUDECODE: '', // allow nested runs from our app
        PATH: buildSpawnPath(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.cancelled = false;
    this.awaitingInput = false;
    this.stderrTail = '';
    this.completed = false;
    this.timeoutOccurred = false;

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
        const sessionId = event.sessionId || this.workId;
        this.callbacks.onEvent(sessionId, event);

        // Detect AskUserQuestion tool use — transition to AWAITING_INPUT
        if (
          event.type === 'assistant' &&
          event.message?.content &&
          event.message.content.some(
            (c: any) => c.type === 'tool_use' && c.name === 'AskUserQuestion'
          )
        ) {
          this.handleAwaitingInput(logStream);
        }
      } catch {
        // Non-JSON line (banner, warning) — ignore
      }
    });

    // ---- stderr: write to log ----
    this.process.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      logStream.write(`[stderr] ${text}`);
      // Keep the last ~4000 chars so we can surface the failure reason in the UI
      this.stderrTail = (this.stderrTail + text).slice(-4000);
    });

    // ---- process exit ----
    this.process.on('exit', (code: number | null) => {
      clearTimeout(this.watchdogTimer!);
      rl.close();
      logStream.write(`\n=== Run exited with code ${code} at ${new Date().toISOString()} ===\n`);
      logStream.end();

      // Guard: if onCompleted was already called (e.g. from error handler), skip
      if (this.completed) return;
      this.completed = true;

      const exitCode = code ?? -1;
      let reason: RunReason;
      if (this.awaitingInput) {
        reason = 'ok';
      } else if (this.timeoutOccurred) {
        reason = 'timeout';
      } else if (this.cancelled) {
        reason = 'stopped';
      } else if (exitCode === 0) {
        reason = 'ok';
      } else if (exitCode === 127) {
        // 127 = command not found — так падает shell-враппер (claude-sm), когда
        // не находит вызываемую функцию. Проблема окружения, не ошибка Claude.
        reason = 'config';
      } else {
        reason = 'error';
      }

      const errorDetail =
        reason === 'error' || reason === 'config'
          ? this.stderrTail.trim() || undefined
          : undefined;

      this.callbacks.onCompleted(this.workId, { exitCode, reason, errorDetail });
      this.process = null;
    });

    // ---- process error ----
    this.process.on('error', (err: Error) => {
      // Guard: if onCompleted was already called (e.g. from exit handler), skip
      if (this.completed) return;
      this.completed = true;

      logStream.write(`[error] ${err.message}\n`);
      clearTimeout(this.watchdogTimer!);
      rl.close();
      logStream.end();

      // ENOENT = бинарника нет в PATH, EACCES = найден, но не исполняемый.
      // И то и другое — проблема конфигурации (неверная команда запуска),
      // а не ошибка Claude.
      const errCode = (err as NodeJS.ErrnoException).code;
      const isMissingCommand = errCode === 'ENOENT' || errCode === 'EACCES';

      this.callbacks.onCompleted(this.workId, {
        exitCode: -1,
        reason: isMissingCommand ? 'config' : 'error',
        errorDetail: err.message,
      });
      this.process = null;
    });

    // Start watchdog
    this.resetWatchdog(watchdogTimeoutMinutes);

    // Notify that the process has started
    this.callbacks.onStarted(this.workId);
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

  private handleAwaitingInput(logStream: fs.WriteStream): void {
    if (!this.isRunning()) return;
    this.awaitingInput = true;
    logStream.write(`[detected AskUserQuestion — closing stdin]\n`);
    this.process!.stdin!.end();

    // Fallback: if process doesn't exit within 5s, force kill
    setTimeout(() => {
      if (this.isRunning()) {
        logStream.write(`[fallback: force kill after AskUserQuestion]\n`);
        this.cancel();
      }
    }, 5000);
  }

  private resetWatchdog(minutes: number): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
    }
    if (minutes <= 0) return;

    this.watchdogTimer = setTimeout(() => {
      if (this.isRunning() && !this.completed) {
        this.timeoutOccurred = true;
        this.cancel();
        // Don't call onCompleted here — the exit handler will do it
        // with reason='timeout' because this.timeoutOccurred is set.
      }
    }, minutes * 60 * 1000);
  }
}
