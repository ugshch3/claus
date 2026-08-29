import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppData, Project, Work, Settings } from '../../shared/types';

const DATA_DIR = path.join(os.homedir(), '.claude');
const DATA_FILE = path.join(DATA_DIR, 'session-manager.json');
const CURRENT_VERSION = 1;

const DEFAULT_SETTINGS: Settings = {
  watchdogTimeoutMinutes: 10,
  defaultMaxTurns: 25,
  defaultProfile: 'generic',
  customPromptFragment: '',
  uiMode: 'classic',
  claudeCommandMode: 'claude',
  claudeCommandCustom: '',
};

function getDefaultData(): AppData {
  return {
    version: CURRENT_VERSION,
    projects: [],
    works: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function load(): AppData {
  if (!fs.existsSync(DATA_FILE)) {
    return getDefaultData();
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data: AppData = JSON.parse(raw);
    if (data.version !== CURRENT_VERSION) {
      return migrate(data);
    }
    // Мерджим дефолты: в файле, записанном прошлой версией приложения,
    // новых полей settings нет — без этого они приедут как undefined.
    return { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
  } catch (err) {
    console.error('Failed to load session-manager.json, using defaults:', err);
    return getDefaultData();
  }
}

export function save(data: AppData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Atomic write: write to temp, then rename
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function migrate(data: AppData): AppData {
  // Future: handle schema migrations here
  // Example: if (data.version === 1) { migrate v1→v2 }
  console.warn(
    `Unknown data version ${data.version}, resetting to defaults`
  );
  return getDefaultData();
}

// Convenience accessors
export function getProjects(): Project[] {
  return load().projects;
}

export function getWorks(): Work[] {
  return load().works;
}

export function getSettings(): Settings {
  return load().settings;
}
