import { execFile } from 'child_process';
import type { PrerequisiteType } from '@shared/types';

const TIMEOUT_MS = 10_000;

const run = (bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(bin, args, { env, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout}${stderr}`.trim() });
    });
  });

export const checkPrerequisites = async (claudeBin: string, env: NodeJS.ProcessEnv): Promise<PrerequisiteType[]> => {
  const [claude, auth, git, gh] = await Promise.all([
    run(claudeBin, ['--version'], env),
    run(claudeBin, ['auth', 'status', '--json'], env),
    run('git', ['--version'], env),
    run('gh', ['auth', 'status'], env),
  ]);
  let signedIn = false;
  let account = '';
  try {
    const data = JSON.parse(auth.out) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
    signedIn = data.loggedIn === true;
    account = [data.email, data.subscriptionType ? `${data.subscriptionType} plan` : ''].filter(Boolean).join(' · ');
  } catch {
    signedIn = false;
  }
  return [
    { id: 'claude', label: 'Claude Code CLI', ok: claude.ok, detail: claude.ok ? claude.out.split('\n')[0] : 'Not found. Install it from docs.claude.com/claude-code, then reopen Trainer HQ.', required: true },
    { id: 'auth', label: 'Signed in to Claude', ok: signedIn, detail: signedIn ? account || 'signed in' : 'Run claude auth login (the button below opens Terminal).', required: true },
    { id: 'git', label: 'git', ok: git.ok, detail: git.ok ? git.out : 'Needed for threads on branches and worktrees. Install Xcode Command Line Tools.', required: false },
    { id: 'gh', label: 'GitHub CLI (optional)', ok: gh.ok, detail: gh.ok ? 'signed in' : 'Optional: lets threads open pull requests by number and lets creatures read PRs.', required: false },
  ];
};
