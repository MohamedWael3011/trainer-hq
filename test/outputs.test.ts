import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { newOutputs, pathsInText } from '../src/main/outputs';

const root = mkdtempSync(join(tmpdir(), 'thq-out-'));
const put = (path: string, ageMs = 0): string => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'x');
  if (ageMs) utimesSync(path, (Date.now() - ageMs) / 1000, (Date.now() - ageMs) / 1000);
  return path;
};

describe('outputs', () => {
  const started = Date.now() - 1_000;
  const fresh = put(join(root, 'shots-1', 'mobile', 'home.png'));
  const page = put(join(root, 'report.html'));
  const old = put(join(root, 'old.png'), 3_600_000);
  put(join(root, 'shots-1', 'notes.txt'));

  it('finds absolute paths in tool output, minus trailing punctuation', () => {
    expect(pathsInText(`Saved 1 shot to ${root}/shots-1.\nSee "${page}"`)).toEqual([`${root}/shots-1`, page]);
  });

  it('keeps files made during the reply, including those in a mentioned folder', () => {
    const found = newOutputs([join(root, 'shots-1'), page, old, join(root, 'missing.png')], started, []);
    expect(found.sort()).toEqual([fresh, page].sort());
  });

  it('ignores broad folders such as the repo root', () => {
    expect(newOutputs([root], started, [root])).toEqual([]);
  });
});
