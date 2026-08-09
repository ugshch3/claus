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

  // Prepend custom instructions so the model treats them as a direct directive.
  // The fragment goes at the very start of the user message for maximum weight.
  if (settings.customPromptFragment && settings.customPromptFragment.trim()) {
    prompt = settings.customPromptFragment.trim() + '\n\n' + prompt;
  }

  args.push('-p', prompt);
  args.push('--output-format', 'stream-json');
  args.push('--verbose');  // required for stream-json to work

  if (settings.defaultMaxTurns > 0) {
    args.push('--max-turns', String(settings.defaultMaxTurns));
  }

  // We use the project-local settings.json that ClaudeConfig generates,
  // so we don't pass --permission-mode explicitly. Claude reads .claude/settings.json.
  // The settings.json includes the PreToolUse hook for Bash classification.

  return args;
}
