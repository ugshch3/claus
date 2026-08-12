// Сканирование скиллов Claude Code и встроенных команд

export interface SkillEntry {
  name: string;
  description: string;
  source: 'global' | 'project' | 'built-in';
}

export interface SkillsListResult {
  skills: SkillEntry[];
  builtIn: SkillEntry[];
}

// Встроенные команды Claude Code (без префикса '/')
export const BUILT_IN_COMMANDS: SkillEntry[] = [
  { name: 'init', description: 'Initialize a CLAUDE.md for the project', source: 'built-in' },
  { name: 'compact', description: 'Compact the conversation context', source: 'built-in' },
  { name: 'model', description: 'Switch the active model', source: 'built-in' },
  { name: 'clear', description: 'Clear the conversation history', source: 'built-in' },
  { name: 'help', description: 'Show help for Claude Code', source: 'built-in' },
  { name: 'doctor', description: 'Diagnose Claude Code setup', source: 'built-in' },
  { name: 'memory', description: 'Open the memory file', source: 'built-in' },
  { name: 'status', description: 'Show current session status', source: 'built-in' },
  { name: 'resume', description: 'Resume a previous conversation', source: 'built-in' },
  { name: 'review', description: 'Review a pull request', source: 'built-in' },
  { name: 'security-review', description: 'Security review of the code', source: 'built-in' },
  { name: 'add-dir', description: 'Add a directory to the workspace', source: 'built-in' },
  { name: 'permissions', description: 'Manage permission rules', source: 'built-in' },
];
