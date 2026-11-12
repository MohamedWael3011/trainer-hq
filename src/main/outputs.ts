import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Files a creature produces that are worth showing: renders, pages and documents.
export const OUTPUT_EXT = /\.(png|jpe?g|gif|webp|svg|html?|pdf)$/i;
const PATH_TOKEN = /(?:~|\/)[^\s'"`<>|;,()[\]{}]+/g;
const TRAILING = /[.:]+$/;
// Files touched shortly before the reply started still count (clocks and write lag).
const SLACK_MS = 5_000;
const MAX_PER_DIR = 60;
const DIR_DEPTH = 2;

const expand = (path: string): string => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

// Absolute paths mentioned in a tool's output or input.
export const pathsInText = (text: string): string[] =>
  Array.from(new Set((text.match(PATH_TOKEN) ?? []).map((token) => expand(token.replace(TRAILING, '')))));

const newerThan = (path: string, since: number): boolean => {
  try {
    return statSync(path).mtimeMs >= since - SLACK_MS;
  } catch {
    return false;
  }
};

// New output files under a folder the creature mentioned, e.g. "saved 12 shots to /x/shots-3".
const filesIn = (dir: string, since: number, depth = 0, found: string[] = []): string[] => {
  if (depth > DIR_DEPTH || found.length >= MAX_PER_DIR) return found;
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return found;
  }
  for (const name of names) {
    if (found.length >= MAX_PER_DIR) break;
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) filesIn(full, since, depth + 1, found);
    else if (OUTPUT_EXT.test(name) && newerThan(full, since)) found.push(full);
  }
  return found;
};

// Which of these paths are outputs made during this reply: matching files written since `since`,
// or such files inside a mentioned folder. Old files the creature only read don't count, and
// neither do broad folders (home, the repo root) where unrelated files may have changed.
export const newOutputs = (paths: string[], since: number, broadDirs: string[]): string[] => {
  const broad = new Set([homedir(), '/', ...broadDirs]);
  const out: string[] = [];
  paths.forEach((path) => {
    if (!existsSync(path)) return;
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      return;
    }
    if (isDir) {
      if (!broad.has(path.replace(/\/+$/, ''))) out.push(...filesIn(path, since));
    } else if (OUTPUT_EXT.test(path) && newerThan(path, since)) {
      out.push(path);
    }
  });
  return Array.from(new Set(out));
};
