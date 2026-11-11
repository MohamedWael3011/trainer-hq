import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ASK_TOOL, Autonomy, MCP_SERVER_NAME, PERMISSION_TOOL, PermissionMode } from '@shared/constants';
import type { CreatureType } from '@shared/types';
import type { ProfileConfigType } from './config';

const MS_PER_MINUTE = 60_000;

export type ClaudeRunPlanType = {
  args: string[];
  timeoutMs?: number;
};

export type PermissionBridgeType = {
  serverScript: string;
  nodeBinary: string;
  port: number;
  token: string;
  questId: string;
};

const mcpConfig = (bridge: PermissionBridgeType): string =>
  JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: bridge.nodeBinary,
        args: [bridge.serverScript],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          THQ_PORT: String(bridge.port),
          THQ_TOKEN: bridge.token,
          THQ_QUEST: bridge.questId,
        },
      },
    },
  });

const subRepos = (dir: string | undefined): string[] => {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(dir, entry.name, '.git')))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
};

// Multi-repo workspaces (e.g. a parent folder whose .git tracks docs while app sub-repos are gitignored)
// break when --worktree is used, because the worktree omits the sub-repos and jails Edit/Write out of them.
const canAutoWorktree = (dir: string | undefined, nestedRepos: string[]): boolean =>
  !!dir && existsSync(join(dir, '.git')) && nestedRepos.length === 0;

// Detect if a saved session ID belongs to an old .claude/worktrees/thq-* run so multi-repo workspaces
// on any machine automatically break out of the worktree jail on their next message.
const isWorktreeSession = (sessionId: string | undefined, claudeConfigDir?: string): boolean => {
  if (!sessionId) return false;
  const projectsDir = join(claudeConfigDir ?? join(homedir(), '.claude'), 'projects');
  if (!existsSync(projectsDir)) return false;
  try {
    return readdirSync(projectsDir).some(
      (name) => name.includes('--claude-worktrees-thq-') && existsSync(join(projectsDir, name, `${sessionId}.jsonl`)),
    );
  } catch {
    return false;
  }
};

export const planClaudeRun = (options: {
  creature: CreatureType;
  profile: ProfileConfigType;
  systemPrompt: string;
  bridge: PermissionBridgeType;
  resumeSessionId?: string;
  questId: string;
  skipWorktree?: boolean;
}): ClaudeRunPlanType => {
  const { creature, profile, systemPrompt, bridge, resumeSessionId, questId, skipWorktree } = options;
  const fullAuto = creature.autonomy === Autonomy.FULL_AUTO;
  const deny = [...profile.guard.alwaysDeny, ...creature.tools.deny];
  const sharedDir = join(profile.vault, 'shared');
  const nestedRepos = subRepos(creature.cwd);
  const effectiveResume = nestedRepos.length > 0 && isWorktreeSession(resumeSessionId, profile.claudeConfigDir)
    ? undefined
    : resumeSessionId;
  const addDirs = Array.from(
    new Set([
      creature.dir,
      ...(creature.cwd && existsSync(creature.cwd) ? [creature.cwd] : []),
      ...nestedRepos,
      ...creature.addDirs,
      ...(existsSync(sharedDir) ? [sharedDir] : []),
    ]),
  );
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', PermissionMode[creature.autonomy],
    '--append-system-prompt', systemPrompt,
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
    '--mcp-config', mcpConfig(bridge),
    '--permission-prompt-tool', `mcp__${MCP_SERVER_NAME}__${PERMISSION_TOOL}`,
  ];
  if (creature.model) args.push('--model', creature.model);
  if (effectiveResume) args.push('--resume', effectiveResume);
  if (fullAuto && profile.guard.fullAutoWorktree && !skipWorktree && canAutoWorktree(creature.cwd, nestedRepos) && !effectiveResume) {
    args.push('--worktree', `thq-${creature.id}-${questId.slice(0, 8)}`);
  }
  args.push('--allowedTools', ...creature.tools.allow, `mcp__${MCP_SERVER_NAME}__${ASK_TOOL}`);
  args.push('--disallowedTools', ...deny);
  return {
    args,
    timeoutMs: fullAuto ? profile.guard.fullAutoMaxMinutes * MS_PER_MINUTE : undefined,
  };
};
