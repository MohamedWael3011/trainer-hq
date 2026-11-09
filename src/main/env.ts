import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const FALLBACK_SHELL = '/bin/zsh';
const SHELL_TIMEOUT_MS = 8000;
const MARKER = '__THQ_PATH__';

// Where CLIs like `claude` usually live. GUI apps on macOS start with a bare PATH,
// so these are always appended in case the login-shell lookup fails or misses them.
const knownBinDirs = (): string[] => {
  const home = homedir();
  const dirs = [
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    join(home, '.npm-global/bin'),
    join(home, '.bun/bin'),
    join(home, '.volta/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const nvmRoot = join(home, '.nvm/versions/node');
  try {
    for (const version of readdirSync(nvmRoot)) dirs.push(join(nvmRoot, version, 'bin'));
  } catch {
    // no nvm
  }
  return dirs.filter((dir) => existsSync(dir));
};

const loginShellPath = (): string | undefined => {
  try {
    const shell = process.env.SHELL || FALLBACK_SHELL;
    const output = execFileSync(shell, ['-ilc', `printf "${MARKER}%s${MARKER}" "$PATH"`], {
      encoding: 'utf8',
      timeout: SHELL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split(MARKER)[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
};

export const loadLoginShellPath = (): void => {
  const parts = [loginShellPath(), process.env.PATH, ...knownBinDirs()]
    .filter(Boolean)
    .flatMap((value) => (value as string).split(':'))
    .filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(':');
};
