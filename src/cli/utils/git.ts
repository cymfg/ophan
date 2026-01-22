import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if a directory is a git repository
 */
export function isGitRepository(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/**
 * Get a simple-git instance for the given directory
 */
export function getGit(dir: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    baseDir: dir,
    binary: 'git',
    maxConcurrentProcesses: 6,
    trimmed: false,
  };

  return simpleGit(options);
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const branchSummary = await git.branch();
  return branchSummary.current;
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(git: SimpleGit): Promise<boolean> {
  const status = await git.status();
  return !status.isClean();
}

/**
 * Create a new branch and switch to it
 */
export async function createBranch(
  git: SimpleGit,
  branchName: string
): Promise<void> {
  await git.checkoutLocalBranch(branchName);
}

/**
 * Commit staged changes
 */
export async function commit(
  git: SimpleGit,
  message: string
): Promise<string> {
  const result = await git.commit(message);
  return result.commit;
}

/**
 * Stage files for commit
 */
export async function stageFiles(
  git: SimpleGit,
  files: string[]
): Promise<void> {
  await git.add(files);
}

/**
 * Get the remote URL for origin
 */
export async function getRemoteUrl(git: SimpleGit): Promise<string | null> {
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    return origin?.refs.fetch ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a branch exists
 */
export async function branchExists(
  git: SimpleGit,
  branchName: string
): Promise<boolean> {
  const branches = await git.branch();
  return branches.all.includes(branchName);
}

/**
 * Get the project name from the git remote or directory name
 */
export async function getProjectName(
  git: SimpleGit,
  fallbackDir: string
): Promise<string> {
  const remoteUrl = await getRemoteUrl(git);

  if (remoteUrl) {
    // Extract repo name from URL like:
    // https://github.com/user/repo.git
    // git@github.com:user/repo.git
    const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  }

  // Fallback to directory name
  return fallbackDir.split('/').pop() ?? 'unknown';
}
