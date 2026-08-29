import * as os from 'os';
import * as path from 'path';
import { Settings } from '../../shared/types';

const PRESET_COMMANDS: Record<string, string> = {
  claude: 'claude',
  'claude-sm': 'claude-sm',
};

/**
 * Разрешить команду запуска Claude Code из настроек.
 * Пустое значение в режиме 'custom' считаем неконфигурированным и падаем
 * обратно на 'claude' — так run завершится понятной ошибкой 'config',
 * а не spawn(undefined).
 */
export function resolveClaudeCommand(settings: Settings): string {
  if (settings.claudeCommandMode === 'custom') {
    const custom = (settings.claudeCommandCustom || '').trim();
    return custom || PRESET_COMMANDS.claude;
  }
  return PRESET_COMMANDS[settings.claudeCommandMode] || PRESET_COMMANDS.claude;
}

/**
 * PATH для дочернего процесса.
 * Запуск .app из Finder даёт урезанный PATH (/usr/bin:/bin:/usr/sbin:/sbin) без
 * пользовательских каталогов, поэтому дописываем типовые места установки CLI.
 * Наследуемый PATH идёт первым — выбор пользователя важнее наших догадок.
 */
export function buildSpawnPath(): string {
  const home = os.homedir();
  const fallbacks = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of fallbacks) {
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs.join(path.delimiter);
}
