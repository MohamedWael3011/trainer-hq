import { execFileSync } from 'child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const HELP_TIMEOUT_MS = 15_000;
const FLAG = /--[a-z][a-z0-9-]+/g;
// Claude Code's help always ends with its subcommand list; without it the text was cut short.
const HELP_END = /\nCommands:/;
const ATTEMPTS = 2;

export type FlagSupportType = (flag: string) => boolean;

const cache = new Map<string, Set<string> | null>();

// `claude --help` into a file, not a pipe: on a busy machine the CLI can exit before a pipe
// drains, cutting the text at 8 KB and hiding every option listed after that point.
const readHelp = (bin: string, env: NodeJS.ProcessEnv): string => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-help-'));
  const file = join(dir, 'help.txt');
  const fd = openSync(file, 'w');
  try {
    execFileSync(bin, ['--help'], { env, timeout: HELP_TIMEOUT_MS, stdio: ['ignore', fd, 'ignore'] });
  } finally {
    closeSync(fd);
  }
  try {
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Which options the installed Claude Code understands, read once from `claude --help`.
// Older versions reject unknown options and fail the whole run, so newer flags are only
// passed when the CLI lists them. If --help can't be read, assume a current CLI.
export const claudeFlagSupport = (bin: string, env: NodeJS.ProcessEnv): FlagSupportType => {
  if (!cache.has(bin)) {
    let flags: Set<string> | null = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const help = readHelp(bin, env);
        const found = new Set(help.match(FLAG) ?? []);
        if (found.size > 0) flags = found;
        if (HELP_END.test(help)) break;
      } catch {
        // Try again; with nothing readable we fall back to assuming a current CLI.
      }
    }
    cache.set(bin, flags);
  }
  const flags = cache.get(bin);
  return (flag: string) => (flags ? flags.has(flag) : true);
};

// After the user updates Claude Code, check again.
export const resetFlagSupport = (): void => cache.clear();

// Appends `flag value...` only when the CLI supports the flag.
export const pushIfSupported = (args: string[], supports: FlagSupportType, flag: string, ...values: string[]): void => {
  if (supports(flag)) args.push(flag, ...values);
};
