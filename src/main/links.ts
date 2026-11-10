import { accessSync, constants, existsSync, statSync } from 'fs';
import { extname, isAbsolute, resolve } from 'path';
import { shell } from 'electron';
import { expandHome } from './paths';

// Opening these would run code, so a click on them only reveals them in Finder.
const RUNNABLE_EXT = new Set([
  '.app', '.command', '.tool', '.sh', '.bash', '.zsh', '.csh', '.fish', '.py', '.rb', '.pl', '.js', '.mjs', '.cjs',
  '.scpt', '.scptd', '.applescript', '.workflow', '.action', '.pkg', '.mpkg', '.dmg', '.terminal', '.jar', '.webloc', '.inetloc', '.fileloc',
]);

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// Turns what a creature wrote ("file:///a/b.md#L3", "~/x", "src/y.ts") into an absolute path.
const toPath = (target: string, bases: string[]): string | undefined => {
  let value = target.trim();
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return undefined;
    }
  } else {
    value = value.replace(/#.*$/, '').replace(/:\d+(:\d+)?$/, '');
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep as written
    }
  }
  if (value === '~' || value.startsWith('~/')) value = expandHome(value);
  if (isAbsolute(value)) return existsSync(value) ? value : undefined;
  return bases.map((base) => resolve(base, value)).find((candidate) => existsSync(candidate));
};

export type OpenLocalResultType = { ok: boolean; path?: string; revealed?: boolean; error?: string };

export const openLocal = async (target: string, bases: string[]): Promise<OpenLocalResultType> => {
  const path = toPath(target, bases);
  if (!path) return { ok: false, error: `Not found: ${target}` };
  const isDir = statSync(path).isDirectory();
  const runnable = RUNNABLE_EXT.has(extname(path).toLowerCase()) || (!isDir && isExecutable(path));
  if (runnable) {
    shell.showItemInFolder(path);
    return { ok: true, path, revealed: true };
  }
  const error = await shell.openPath(path);
  return error ? { ok: false, path, error } : { ok: true, path };
};
