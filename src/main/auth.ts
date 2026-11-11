import { execFile } from 'child_process';
import type { AuthStatusType } from '@shared/types';

const AUTH_TIMEOUT_MS = 15_000;

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const checkAuth = (bin: string, env: NodeJS.ProcessEnv): Promise<AuthStatusType> =>
  new Promise((resolve) => {
    execFile(bin, ['auth', 'status', '--json'], { env, timeout: AUTH_TIMEOUT_MS }, (error, stdout) => {
      try {
        const data = JSON.parse(stdout) as Record<string, unknown>;
        resolve({
          loggedIn: data.loggedIn === true,
          email: typeof data.email === 'string' ? data.email : undefined,
          plan: typeof data.subscriptionType === 'string' ? data.subscriptionType : undefined,
          method: typeof data.authMethod === 'string' ? data.authMethod : undefined,
          expiresAt: typeof data.loginExpiresAt === 'string' ? Date.parse(data.loginExpiresAt) : undefined,
          checkedAt: Date.now(),
        });
      } catch {
        resolve({ loggedIn: false, checkedAt: Date.now(), error: error?.message ?? 'Could not read Claude login status.' });
      }
    });
  });

export const runInTerminal = (command: string): void => {
  const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`;
  execFile('osascript', ['-e', script]);
};

const configPrefix = (claudeConfigDir?: string): string => (claudeConfigDir ? `CLAUDE_CONFIG_DIR=${quote(claudeConfigDir)} ` : '');

export const openLoginTerminal = (bin: string, claudeConfigDir?: string): void => {
  runInTerminal(`${configPrefix(claudeConfigDir)}${quote(bin)} auth login`);
};

// Continue an app chat in the real Claude Code terminal UI, from the folder it ran in.
export const openSessionTerminal = (options: { bin: string; cwd: string; sessionId: string; addDirs: string[]; claudeConfigDir?: string }): void => {
  const dirs = options.addDirs.map((dir) => ` --add-dir ${quote(dir)}`).join('');
  runInTerminal(`cd ${quote(options.cwd)} && ${configPrefix(options.claudeConfigDir)}${quote(options.bin)} --resume ${quote(options.sessionId)}${dirs}`);
};
