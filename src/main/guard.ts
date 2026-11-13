import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { ASK_TOOL, Autonomy, MCP_SERVER_NAME, PERMISSION_TOOL, PermissionMode, SCHEDULE_TOOL } from '@shared/constants';
import type { CreatureType } from '@shared/types';
import { autocompactWindow, type ProfileConfigType } from './config';
import { pushIfSupported, type FlagSupportType } from './engines/claudeFlags';

const MS_PER_MINUTE = 60_000;
const SETTINGS_FLAG = '--settings';
const ARTIFACT_TOOL = /^Artifact/;

export type RunContextType = {
  artifacts: boolean;
  slashCommands: boolean;
  connectors: boolean;
};

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

const retiredWorktreeNote = (cwd: string, nestedRepos: string[]): string =>
  [
    'Your previous session ran inside a git worktree under `.claude/worktrees/thq-*`. That worktree is retired and its session was dropped.',
    `Work only in the main checkout at \`${cwd}\` and its sub-repos (${nestedRepos.map((dir) => `\`${basename(dir)}\``).join(', ')}).`,
    'Do not cd into, edit, or recreate anything under `.claude/worktrees/`, and do not pass --worktree.',
  ].join(' ');

const LOG_TAIL_BYTES = 512 * 1024;

// Conversation size of a saved session, read from the tail of its transcript. Used for sessions
// that ran before the app started recording context size per reply.
export const sessionContextFromLog = (sessionId: string, claudeConfigDir?: string): number | undefined => {
  const projectsDir = join(claudeConfigDir ?? join(homedir(), '.claude'), 'projects');
  try {
    const dir = readdirSync(projectsDir).find((name) => existsSync(join(projectsDir, name, `${sessionId}.jsonl`)));
    if (!dir) return undefined;
    const file = join(projectsDir, dir, `${sessionId}.jsonl`);
    const size = statSync(file).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      try {
        const usage = JSON.parse(line)?.message?.usage;
        if (!usage) continue;
        const total = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
        if (total > 0) return total;
      } catch {
        // A partial first line from the tail read; keep looking.
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

// When the chosen model is overloaded, retry on a lighter one instead of failing. Never "fall back"
// to the same or a more expensive model: cheap creatures (Sonnet, Haiku) just retry as they are.
export const fallbackModel = (model: string | undefined, configured: string): string | undefined => {
  if (!configured) return undefined;
  const current = (model ?? '').toLowerCase();
  if (current.includes('sonnet') || current.includes('haiku')) return undefined;
  if (current && current === configured.toLowerCase()) return undefined;
  return configured;
};

export const planClaudeRun = (options: {
  creature: CreatureType;
  profile: ProfileConfigType;
  systemPrompt: string;
  bridge: PermissionBridgeType;
  resumeSessionId?: string;
  questId: string;
  skipWorktree?: boolean;
  // Which CLI options the installed Claude Code knows; newer ones are skipped on older versions.
  supports?: FlagSupportType;
  // Shown in `claude --resume` so the chat is easy to find from a terminal.
  sessionName?: string;
  context?: RunContextType;
  floorTokens?: number;
}): ClaudeRunPlanType => {
  const { creature, profile, systemPrompt, bridge, resumeSessionId, questId, skipWorktree, sessionName } = options;
  const supports = options.supports ?? (() => true);
  const fullAuto = creature.autonomy === Autonomy.FULL_AUTO;
  const context = options.context ?? { artifacts: true, slashCommands: true, connectors: true };
  const allow = context.artifacts ? creature.tools.allow : creature.tools.allow.filter((rule) => !ARTIFACT_TOOL.test(rule));
  const compactWindow = autocompactWindow(profile.session.autocompactTokens, options.floorTokens);
  const askBeyondLimits = profile.guard.askBeyondLimits && supports(SETTINGS_FLAG);
  const limits = [...profile.guard.alwaysDeny, ...creature.tools.deny];
  const deny = askBeyondLimits ? [] : limits;
  const ask = [...creature.tools.ask, ...(askBeyondLimits ? limits : [])];
  const sharedDir = join(profile.vault, 'shared');
  const nestedRepos = subRepos(creature.cwd);
  const droppedLegacySession = nestedRepos.length > 0 && isWorktreeSession(resumeSessionId, profile.claudeConfigDir);
  const effectiveResume = droppedLegacySession ? undefined : resumeSessionId;
  // The fresh session has no memory of the worktree, but its files and notes may still mention it.
  // Say plainly that it is gone, so the model does not cd back into it or recreate it.
  const prompt = droppedLegacySession ? `${systemPrompt}\n\n${retiredWorktreeNote(creature.cwd!, nestedRepos)}` : systemPrompt;
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
    '--append-system-prompt', prompt,
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
    '--mcp-config', mcpConfig(bridge),
    '--permission-prompt-tool', `mcp__${MCP_SERVER_NAME}__${PERMISSION_TOOL}`,
  ];
  if (creature.model) args.push('--model', creature.model);
  const fallback = fallbackModel(creature.model, profile.session.fallbackModel);
  if (fallback) pushIfSupported(args, supports, '--fallback-model', fallback);
  if (creature.effort) pushIfSupported(args, supports, '--effort', creature.effort);
  // Keep per-folder details (cwd, git status) out of the system prompt so the shared prefix caches across creatures.
  pushIfSupported(args, supports, '--exclude-dynamic-system-prompt-sections');
  if (compactWindow > 0) pushIfSupported(args, supports, '--autocompact', String(compactWindow));
  if (!context.slashCommands) pushIfSupported(args, supports, '--disable-slash-commands');
  if (!context.connectors) pushIfSupported(args, supports, '--strict-mcp-config');
  if (sessionName) pushIfSupported(args, supports, '--name', sessionName);
  if (effectiveResume) args.push('--resume', effectiveResume);
  if (fullAuto && profile.guard.fullAutoWorktree && !skipWorktree && canAutoWorktree(creature.cwd, nestedRepos) && !effectiveResume) {
    args.push('--worktree', `thq-${creature.id}-${questId.slice(0, 8)}`);
  }
  if (fullAuto && profile.guard.fullAutoMaxBudgetUsd) pushIfSupported(args, supports, '--max-budget-usd', String(profile.guard.fullAutoMaxBudgetUsd));
  args.push('--allowedTools', ...allow, `mcp__${MCP_SERVER_NAME}__${ASK_TOOL}`, `mcp__${MCP_SERVER_NAME}__${SCHEDULE_TOOL}`);
  if (deny.length > 0) args.push('--disallowedTools', ...deny);
  if (ask.length > 0) pushIfSupported(args, supports, SETTINGS_FLAG, JSON.stringify({ permissions: { ask } }));
  return {
    args,
    timeoutMs: fullAuto ? profile.guard.fullAutoMaxMinutes * MS_PER_MINUTE : undefined,
  };
};
