import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { discardFiles, editedPath, reviewFiles } from '../src/main/review';

let repo = '';
const gitIn = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'thq-review-')));
  gitIn('init', '-q');
  gitIn('config', 'user.email', 'test@example.com');
  gitIn('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'kept.ts'), 'export const a = 1;\n');
  gitIn('add', '.');
  gitIn('commit', '-qm', 'start');
});

describe('review inbox', () => {
  it('only counts tools that change files, by absolute path', () => {
    expect(editedPath('Edit', { file_path: '/x/a.ts' })).toBe('/x/a.ts');
    expect(editedPath('NotebookEdit', { notebook_path: '/x/n.ipynb' })).toBe('/x/n.ipynb');
    expect(editedPath('Read', { file_path: '/x/a.ts' })).toBeUndefined();
    expect(editedPath('Write', { file_path: 'relative.ts' })).toBeUndefined();
  });

  it('shows a diff for edited and new files, and nothing for files back as committed', () => {
    writeFileSync(join(repo, 'kept.ts'), 'export const a = 2;\n');
    writeFileSync(join(repo, 'fresh.ts'), 'export const b = 1;\n');
    const [edited, fresh] = reviewFiles([join(repo, 'kept.ts'), join(repo, 'fresh.ts')]);
    expect(edited.status).toBe('modified');
    expect(edited.diff).toContain('+export const a = 2;');
    expect(fresh.status).toBe('untracked');
    expect(fresh.diff).toContain('+export const b = 1;');
    gitIn('checkout', '--', 'kept.ts');
    expect(reviewFiles([join(repo, 'kept.ts')])[0].status).toBe('unchanged');
    expect(reviewFiles([join(tmpdir(), 'not-a-repo-file.txt')])[0].status).toBe('outside');
  });

  it('discards by restoring edits and trashing new files', async () => {
    writeFileSync(join(repo, 'kept.ts'), 'export const a = 2;\n');
    writeFileSync(join(repo, 'fresh.ts'), 'export const b = 1;\n');
    const trashed: string[] = [];
    const failed = await discardFiles([join(repo, 'kept.ts'), join(repo, 'fresh.ts')], async (path) => {
      trashed.push(path);
      rmSync(path);
    });
    expect(failed).toEqual([]);
    expect(readFileSync(join(repo, 'kept.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(trashed).toEqual([join(repo, 'fresh.ts')]);
    expect(existsSync(join(repo, 'fresh.ts'))).toBe(false);
  });

  it('brings back a committed file the quest deleted', async () => {
    rmSync(join(repo, 'kept.ts'));
    expect(reviewFiles([join(repo, 'kept.ts')])[0].status).toBe('deleted');
    await discardFiles([join(repo, 'kept.ts')], async () => undefined);
    expect(readFileSync(join(repo, 'kept.ts'), 'utf8')).toBe('export const a = 1;\n');
  });
});
