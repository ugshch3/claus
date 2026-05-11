import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.claude', 'session-manager-logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function formatMessage(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}\n`;
}

export function logInfo(message: string): void {
  ensureDir();
  fs.appendFileSync(LOG_FILE, formatMessage('INFO', message));
}

export function logError(message: string, err?: unknown): void {
  ensureDir();
  const extra = err instanceof Error ? ` | ${err.stack || err.message}` : err ? ` | ${String(err)}` : '';
  fs.appendFileSync(LOG_FILE, formatMessage('ERROR', message + extra));
}

export function logWarn(message: string): void {
  ensureDir();
  fs.appendFileSync(LOG_FILE, formatMessage('WARN', message));
}
