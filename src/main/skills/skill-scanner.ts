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

/**
 * Парсит YAML-фронтматтер SKILL.md и возвращает name + description.
 * Обрабатывает inline-значения (`name: foo`) и блочные скаляры
 * (`description: >` с отступом продолжения).
 * Возвращает null, если фронтматтер отсутствует или нет поля name.
 */
export function parseSkillFrontmatter(
  content: string
): { name: string; description: string } | null {
  const match = content.match(/^\s*---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const name = extractField(frontmatter, 'name');
  if (!name) return null;

  const description = extractField(frontmatter, 'description') || '';
  return { name, description };
}

/**
 * Извлекает значение поля из YAML-фронтматтера.
 * Поддерживает `key: value` и `key: >` / `key: |` с многострочным телом.
 */
function extractField(frontmatter: string, key: string): string | null {
  const lines = frontmatter.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;

    const inlineValue = match[1].trim();

    // Блочный скаляр: маркер `>` или `|`, либо пустое значение
    if (inlineValue === '>' || inlineValue === '|' || inlineValue === '') {
      const blockLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') {
          // Пустая строка внутри блока — сохраняем и продолжаем
          blockLines.push('');
          j++;
          continue;
        }
        if (/^\s/.test(nextLine)) {
          blockLines.push(nextLine.trim());
          j++;
        } else {
          break;
        }
      }
      return blockLines.filter(l => l.length > 0).join(' ');
    }

    return inlineValue;
  }
  return null;
}

