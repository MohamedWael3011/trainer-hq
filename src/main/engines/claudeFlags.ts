import { execFileSync } from 'child_process';

const HELP_TIMEOUT_MS = 15_000;
const FLAG = /--[a-z][a-z0-9-]+/g;

export type FlagSupportType = (flag: string) => boolean;

const cache = new Map<string, Set<string> | null>();

// Which options the installed Claude Code understands, read once from `claude --help`.
// Older versions reject unknown options and fail the whole run, so newer flags are only
// passed when the CLI lists them. If --help can't be read, assume a current CLI.
export const claudeFlagSupport = (bin: string, env: NodeJS.ProcessEnv): FlagSupportType => {
  if (!cache.has(bin)) {
    try {
      const help = execFileSync(bin, ['--help'], { env, timeout: HELP_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const flags = new Set(help.match(FLAG) ?? []);
      cache.set(bin, flags.size > 0 ? flags : null);
    } catch {
      cache.set(bin, null);
    }
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
