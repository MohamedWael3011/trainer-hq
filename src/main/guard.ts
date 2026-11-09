import { existsSync } from 'fs';
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

const isGitRepo = (dir: string | undefined): boolean => !!dir && existsSync(join(dir, '.git'));

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
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', PermissionMode[creature.autonomy],
    '--append-system-prompt', systemPrompt,
    '--add-dir', creature.dir,
    ...creature.addDirs.flatMap((dir) => ['--add-dir', dir]),
    '--mcp-config', mcpConfig(bridge),
    '--permission-prompt-tool', `mcp__${MCP_SERVER_NAME}__${PERMISSION_TOOL}`,
  ];
  if (creature.model) args.push('--model', creature.model);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (fullAuto && profile.guard.fullAutoWorktree && !skipWorktree && isGitRepo(creature.cwd) && !resumeSessionId) {
    args.push('--worktree', `thq-${creature.id}-${questId.slice(0, 8)}`);
  }
  args.push('--allowedTools', ...creature.tools.allow, `mcp__${MCP_SERVER_NAME}__${ASK_TOOL}`);
  args.push('--disallowedTools', ...deny);
  return {
    args,
    timeoutMs: fullAuto ? profile.guard.fullAutoMaxMinutes * MS_PER_MINUTE : undefined,
  };
};
