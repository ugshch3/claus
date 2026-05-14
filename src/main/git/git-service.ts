import { execSync } from 'child_process';
import * as path from 'path';

// ---- Error classes ----

export class GitError extends Error {
  code: string;
  userMessage: string;
  constructor(code: string, userMessage: string, cause?: string) {
    super(cause ?? userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.name = 'GitError';
  }
}

export class DirtyRepoError extends GitError {
  files: string[];
  constructor(files: string[]) {
    super(
      'DIRTY_REPO',
      'В репозитории есть незакоммиченные изменения',
      `Dirty repo: ${files.join(', ')}`
    );
    this.files = files;
    this.name = 'DirtyRepoError';
  }
}

export class BranchExistsError extends GitError {
  constructor(branchName: string) {
    super(
      'BRANCH_EXISTS',
      `Ветка '${branchName}' уже существует`,
      `Branch exists: ${branchName}`
    );
    this.name = 'BranchExistsError';
  }
}

export class CheckoutError extends GitError {
  constructor(branchName: string, cause: string) {
    super(
      'CHECKOUT_ERROR',
      `Не удалось переключиться на ветку '${branchName}'`,
      cause
    );
    this.name = 'CheckoutError';
  }
}

export class GitNotFoundError extends GitError {
  constructor() {
    super('GIT_NOT_FOUND', 'Git не установлен');
    this.name = 'GitNotFoundError';
  }
}

function checkGitAvailable(): void {
  try {
    execSync('git --version', { timeout: 5000, stdio: 'pipe' });
  } catch {
    throw new GitNotFoundError();
  }
}

// ---- Git operations ----

const EXEC_OPTS = { timeout: 30000, stdio: 'pipe' as const, encoding: 'utf-8' as const };

function git(cwd: string, args: string): string {
  checkGitAvailable();
  try {
    return execSync(`git ${args}`, { ...EXEC_OPTS, cwd }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.trim() || err.message || 'Unknown git error';
    throw new GitError('GIT_ERROR', `Git error: ${stderr}`, stderr);
  }
}

export function isDirty(projectPath: string): { isDirty: boolean; files: string[] } {
  const output = git(projectPath, 'status --porcelain');
  if (!output) {
    return { isDirty: false, files: [] };
  }
  const lines = output.split('\n').filter(l => l.length > 0);
  // Each line: "XY filename" — XY are status codes, then space, then filename
  const files = lines
    .map(l => l.substring(3))
    .filter(f => !f.startsWith('.claude/')); // app-managed directory
  return { isDirty: files.length > 0, files };
}

export function discardChanges(projectPath: string): void {
  git(projectPath, 'checkout -- .');
  // Also remove untracked files and directories
  try {
    git(projectPath, 'clean -fd');
  } catch {
    // clean may fail if there's nothing to clean — ignore
  }
}

export function branchExists(projectPath: string, branchName: string): boolean {
  try {
    const output = git(projectPath, `branch --list ${branchName}`);
    return output.length > 0;
  } catch {
    return false;
  }
}

export function createBranch(
  projectPath: string,
  branchName: string,
  baseBranch: string
): void {
  // Fetch latest from remote to ensure base branch is up to date
  try {
    git(projectPath, 'fetch origin');
  } catch {
    // Fetch may fail if no remote — ignore
  }
  // Create and switch to new branch
  git(projectPath, `checkout -b ${branchName} ${baseBranch}`);
}

export function checkout(projectPath: string, branchName: string): void {
  try {
    git(projectPath, `checkout ${branchName}`);
  } catch (err: any) {
    throw new CheckoutError(branchName, err.message || 'Unknown checkout error');
  }
}

export function getCurrentBranch(projectPath: string): string {
  return git(projectPath, 'branch --show-current');
}

export function getDefaultBranch(projectPath: string): string {
  const branches = git(projectPath, 'branch -a');
  // Try main first, then master
  for (const name of ['main', 'master']) {
    if (branches.includes(name)) {
      return name;
    }
  }
  throw new GitError(
    'NO_DEFAULT_BRANCH',
    'Не найдена основная ветка (main или master)'
  );
}

export function getRemotes(projectPath: string): string[] {
  try {
    const output = git(projectPath, 'remote -v');
    if (!output) return [];
    const remotes = new Set<string>();
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+/);
      if (match) remotes.add(match[1]);
    }
    return [...remotes];
  } catch {
    return [];
  }
}
