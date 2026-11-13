import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ThreadKind, type ThreadKindType } from '@shared/constants';
import type { ThreadCreateRequestType, ThreadType } from '@shared/types';
import { appHome, profileHome } from './paths';

const THREADS_FILE = 'threads.json';
const SAFE = /[^a-zA-Z0-9._-]+/g;
const GIT_TIMEOUT_MS = 120_000;
const TITLE_LIMIT = 48;

type ThreadSeedType = Pick<ThreadType, 'creatureId' | 'title'> & Partial<Pick<ThreadType, 'repo' | 'cwd' | 'branch' | 'pr' | 'recap' | 'note' | 'archived'>> & { kind: ThreadKindType };

export const threadTitle = (text: string, fallback: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  return flat.length > TITLE_LIMIT ? `${flat.slice(0, TITLE_LIMIT)}…` : flat;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const branchExists = (repo: string, ref: string): boolean => {
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
};

const prBranch = (repo: string, pr: string): string => {
  const number = pr.match(/(\d+)\s*$/)?.[1];
  if (!number) throw new Error(`"${pr}" is not a PR number or URL.`);
  return execFileSync('gh', ['pr', 'view', number, '--json', 'headRefName', '-q', '.headRefName'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  }).trim();
};

export const threadKey = (creatureId: string, threadId?: string): string => (threadId ? `${creatureId}:${threadId}` : creatureId);

export class ThreadStore {
  private threads: ThreadType[] = [];
  private file = '';

  load(profileId: string): void {
    const dir = profileHome(profileId);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, THREADS_FILE);
    try {
      this.threads = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as ThreadType[]) : [];
    } catch {
      this.threads = [];
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.threads, null, 2));
  }

  list(): ThreadType[] {
    return this.threads;
  }

  get(id: string | undefined): ThreadType | undefined {
    return id ? this.threads.find((thread) => thread.id === id) : undefined;
  }

  create(request: ThreadCreateRequestType, repoPath: string | undefined): ThreadType {
    const id = randomUUID().slice(0, 8);
    const thread: ThreadType = {
      id,
      creatureId: request.creatureId,
      title: request.title.trim() || 'New thread',
      repo: request.repo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
    };
    if (repoPath) {
      thread.cwd = repoPath;
      let branch = request.branch?.trim() || undefined;
      if (request.pr?.trim()) {
        branch = prBranch(repoPath, request.pr.trim());
        thread.pr = request.pr.trim();
      }
      if (branch) thread.branch = branch;
      if (request.worktree) {
        const folder = join(appHome(), 'worktrees', `${request.repo ?? 'repo'}-${(branch ?? 'thread').replace(SAFE, '-')}-${id}`);
        mkdirSync(join(appHome(), 'worktrees'), { recursive: true });
        if (branch) {
          try {
            git(repoPath, ['fetch', 'origin', branch]);
          } catch {
            thread.note = `Could not fetch origin/${branch}; using the local branch if it exists.`;
          }
          if (branchExists(repoPath, branch)) git(repoPath, ['worktree', 'add', folder, branch]);
          else if (branchExists(repoPath, `origin/${branch}`)) git(repoPath, ['worktree', 'add', '-b', branch, folder, `origin/${branch}`]);
          else git(repoPath, ['worktree', 'add', '-b', branch, folder]);
        } else {
          git(repoPath, ['worktree', 'add', '--detach', folder]);
        }
        thread.cwd = folder;
        thread.worktree = folder;
      }
    }
    this.threads.push(thread);
    this.save();
    return thread;
  }

  adopt(creatureId: string, title: string, cwd: string | undefined, recap: string, sessionId: string): ThreadType {
    const thread: ThreadType = {
      id: randomUUID().slice(0, 8),
      creatureId,
      title: title.trim() || 'Adopted session',
      cwd,
      recap: recap || undefined,
      adoptedFrom: sessionId,
      note: 'Adopted from a terminal session: starts fresh with a short recap.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
    };
    this.threads.push(thread);
    this.save();
    return thread;
  }

  add(seed: ThreadSeedType): ThreadType {
    const now = Date.now();
    const thread: ThreadType = {
      ...seed,
      id: randomUUID().slice(0, 8),
      createdAt: now,
      updatedAt: now,
      archived: !!seed.archived,
      archivedAt: seed.archived ? now : undefined,
    };
    this.threads.push(thread);
    this.save();
    return thread;
  }

  restore(id: string): void {
    const thread = this.get(id);
    if (!thread) return;
    thread.archived = false;
    thread.archivedAt = undefined;
    if (thread.kind === ThreadKind.CLEARED) thread.kind = ThreadKind.CHAT;
    this.save();
  }

  remove(id: string, repoPath: string | undefined): void {
    const thread = this.get(id);
    if (!thread) return;
    if (thread.worktree && existsSync(thread.worktree)) {
      if (!repoPath) throw new Error('This thread still has a worktree, and its repo is no longer in profile.yaml. Remove the worktree first.');
      try {
        git(repoPath, ['worktree', 'remove', thread.worktree]);
      } catch (error) {
        throw new Error(`Not deleted, its worktree could not be removed: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    this.threads = this.threads.filter((entry) => entry.id !== id);
    this.save();
  }

  setRecap(id: string, recap: string): void {
    const thread = this.get(id);
    if (!thread || !recap) return;
    thread.recap = recap;
    this.save();
  }

  consumeRecap(id: string): void {
    const thread = this.get(id);
    if (!thread?.recap) return;
    thread.recap = undefined;
    this.save();
  }

  touch(id: string): void {
    const thread = this.get(id);
    if (!thread) return;
    thread.updatedAt = Date.now();
    this.save();
  }

  archive(id: string, removeWorktree: boolean, repoPath: string | undefined): void {
    const thread = this.get(id);
    if (!thread) return;
    thread.archived = true;
    thread.archivedAt = Date.now();
    if (removeWorktree && thread.worktree && repoPath) {
      try {
        git(repoPath, ['worktree', 'remove', thread.worktree]);
        thread.worktree = undefined;
      } catch (error) {
        thread.note = `Worktree kept: ${(error as Error).message.split('\n')[0]}`;
      }
    }
    this.save();
  }
}
