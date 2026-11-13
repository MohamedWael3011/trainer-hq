import { mkdirSync, mkdtempSync, existsSync, writeFileSync, utimesSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Lab } from '../src/main/lab';
import type { LabConfigType } from '../src/main/config';

const HOUR_S = 60 * 60;
const MARKER = '.bappzaar-commit';

const touchTree = (dir: string, secondsAgo: number): void => {
  const at = Date.now() / 1000 - secondsAgo;
  const walk = (path: string): void => {
    readdirSync(path, { withFileTypes: true }).forEach((entry) => {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      utimesSync(full, at, at);
    });
    utimesSync(path, at, at);
  };
  walk(dir);
};

const makeWorkspace = (home: string, name: string, hoursAgo: number, serverPid?: number): string => {
  const dir = join(home, name);
  mkdirSync(join(dir, 'app', 'harness'), { recursive: true });
  mkdirSync(join(dir, 'shots-menu'), { recursive: true });
  writeFileSync(join(dir, MARKER), 'abc123');
  writeFileSync(join(dir, 'shots-menu', 'shot.png'), '');
  if (serverPid) writeFileSync(join(dir, 'app', 'harness', '.devserver.8791.pid'), String(serverPid));
  touchTree(dir, hoursAgo * HOUR_S);
  return dir;
};

const labFor = (home: string): Lab => {
  const config = { home, skill: home, title: 'Lab', markerFile: MARKER, refFile: '.bappzaar-ref', serverScript: 'app/harness/bin/restart_server.sh', readyPath: 'app/node_modules', port: 8787 } as unknown as LabConfigType;
  return new Lab(() => ({ config, env: {} }), () => undefined);
};

describe('Lab workspace cleanup', () => {
  it('keeps the two newest workspaces and slims older idle ones, keeping their shots', () => {
    const home = mkdtempSync(join(tmpdir(), 'lab-'));
    const newest = makeWorkspace(home, 'a', 1);
    const second = makeWorkspace(home, 'b', 10);
    const old = makeWorkspace(home, 'c', 20);
    expect(labFor(home).pruneOld()).toEqual(['c']);
    expect(existsSync(join(old, 'app'))).toBe(false);
    expect(existsSync(join(old, 'shots-menu', 'shot.png'))).toBe(true);
    expect(existsSync(join(newest, 'app'))).toBe(true);
    expect(existsSync(join(second, 'app'))).toBe(true);
  });

  it('leaves a recently used workspace alone even when it is not among the newest two', () => {
    const home = mkdtempSync(join(tmpdir(), 'lab-'));
    makeWorkspace(home, 'a', 1);
    makeWorkspace(home, 'b', 2);
    makeWorkspace(home, 'c', 3);
    expect(labFor(home).pruneOld()).toEqual([]);
  });

  it('never slims a workspace whose dev server is still running', () => {
    const home = mkdtempSync(join(tmpdir(), 'lab-'));
    makeWorkspace(home, 'a', 1);
    makeWorkspace(home, 'b', 2);
    const busy = makeWorkspace(home, 'c', 30, process.pid);
    expect(labFor(home).pruneOld()).toEqual([]);
    expect(existsSync(join(busy, 'app'))).toBe(true);
    expect(() => labFor(home).freeSpace('c')).toThrow(/in use/);
  });

  it('frees space on request and reports the workspace as slim', () => {
    const home = mkdtempSync(join(tmpdir(), 'lab-'));
    makeWorkspace(home, 'a', 0);
    const lab = labFor(home);
    lab.freeSpace('a');
    expect(lab.state().workspaces[0]).toMatchObject({ id: 'a', slim: true, inUse: false });
  });
});
