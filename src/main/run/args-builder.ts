import { Settings } from '../../shared/types';

/**
 * Build the argument array for `claude -p` command.
 */
export function buildArgs(
  sessionId: string,
  prompt: string,
  settings: Settings,
  isResume: boolean = false
): string[] {
  const args: string[] = [];

  if (isResume) {
    args.push('--resume', sessionId);
  } else {
    args.push('--session-id', sessionId);
  }

  args.push('-p', prompt);
  args.push('--output-format', 'stream-json');

  if (settings.defaultMaxTurns > 0) {
    args.push('--max-turns', String(settings.defaultMaxTurns));
  }

  // We use the project-local settings.json that ClaudeConfig generates,
  // so we don't pass --permission-mode explicitly. Claude reads .claude/settings.json.
  // The settings.json includes the PreToolUse hook for Bash classification.

  return args;
}
