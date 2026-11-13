import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { dirname, relative } from 'path';
import { ReviewFileStatus, type ReviewFileStatusType } from '@shared/constants';
import type { ReviewFileType } from '@shared/types';

// The tools that change files on disk. Their input names the file in file_path (notebook_path for notebooks).
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DIFF_LIMIT = 60_000;
const NULL_DEVICE = '/dev/null';

export const editedPath = (name: string, input: Record<string, unknown>): string | undefined => {
  if (!EDIT_TOOLS.has(name)) return undefined;
  const target = input.file_path ?? input.notebook_path;
  return typeof target === 'string' && target.startsWith('/') ? target : undefined;
};

const git = (cwd: string, args: string[]): { code: number; out: string } => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { code: result.status ?? 1, out: result.stdout ?? '' };
};

// The nearest folder that still exists, since a file the quest deleted has no folder of its own to run git in.
const existingDir = (path: string): string => {
  let dir = dirname(path);
  while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
  return dir;
};

const repoRoot = (path: string): string | undefined => {
  const { code, out } = git(existingDir(path), ['rev-parse', '--show-toplevel']);
  return code === 0 && out.trim() ? out.trim() : undefined;
};

const statusOf = (root: string, rel: string): ReviewFileStatusType => {
  const line = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', rel]).out.split('\n')[0] ?? '';
  const code = line.slice(0, 2);
  if (!line) return ReviewFileStatus.UNCHANGED;
  if (code === '??') return ReviewFileStatus.UNTRACKED;
  if (code.includes('A')) return ReviewFileStatus.ADDED;
  if (code.includes('D')) return ReviewFileStatus.DELETED;
  return ReviewFileStatus.MODIFIED;
};

const clipDiff = (diff: string): { diff: string; truncated: boolean } =>
  diff.length > DIFF_LIMIT ? { diff: diff.slice(0, DIFF_LIMIT), truncated: true } : { diff, truncated: false };

// What each file looks like now against the last commit. It shows the file as it is, so edits made
// after the quest (by you or another quest) show up too.
export const reviewFiles = (paths: string[]): ReviewFileType[] =>
  paths.map((path) => {
    const root = repoRoot(path);
    if (!root) return { path, status: ReviewFileStatus.OUTSIDE, diff: '', truncated: false };
    const rel = relative(root, path);
    const status = statusOf(root, rel);
    if (status === ReviewFileStatus.UNCHANGED) return { path, repo: root, status, diff: '', truncated: false };
    const isDir = existsSync(path) && statSync(path).isDirectory();
    const diff = status === ReviewFileStatus.UNTRACKED && !isDir
      ? git(root, ['diff', '--no-color', '--no-index', '--', NULL_DEVICE, rel]).out
      : git(root, ['diff', '--no-color', 'HEAD', '--', rel]).out;
    return { path, repo: root, status, ...clipDiff(diff) };
  });

// Puts each file back the way the last commit has it. New files go to the Trash rather than being
// deleted, so a mistaken discard can be undone from there.
export const discardFiles = async (paths: string[], trash: (path: string) => Promise<void>): Promise<string[]> => {
  const failed: string[] = [];
  for (const path of paths) {
    const root = repoRoot(path);
    if (!root) {
      failed.push(path);
      continue;
    }
    const rel = relative(root, path);
    const status = statusOf(root, rel);
    if (status === ReviewFileStatus.UNCHANGED) continue;
    if (status === ReviewFileStatus.UNTRACKED || status === ReviewFileStatus.ADDED) {
      if (status === ReviewFileStatus.ADDED) git(root, ['restore', '--staged', '--', rel]);
      try {
        if (existsSync(path)) await trash(path);
      } catch {
        failed.push(path);
      }
      continue;
    }
    if (git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', rel]).code !== 0) failed.push(path);
  }
  return failed;
};
