import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import type { TerminalSessionType } from '@shared/types';

const TAIL_BYTES = 512 * 1024;
const TRANSCRIPT_EXT = '.jsonl';
const THQ_WORKTREE_MARK = '--claude-worktrees-thq-';
const SDK_ENTRYPOINT = 'sdk-cli';
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MAX_AGE_HOURS = 48;
const LIST_MIN_TOKENS = 100_000;
const LIST_LIMIT = 8;
const TITLE_LIMIT = 80;
const RECAP_EXCHANGES = 3;
const RECAP_ASK_CHARS = 500;
const RECAP_ANSWER_CHARS = 1_500;

const RecordType = {
  ASSISTANT: 'assistant',
  USER: 'user',
  LAST_PROMPT: 'last-prompt',
} as const;

const BlockType = {
  TEXT: 'text',
} as const;

export type WatchOptionsType = {
  largeTokens: number;
  coldMinutes: number;
};

type ScannedType = TerminalSessionType & { file: string; internal: boolean };
type CachedType = { mtimeMs: number; size: number; scanned: ScannedType | undefined };

const cache = new Map<string, CachedType>();

const projectsDir = (claudeConfigDir?: string): string => join(claudeConfigDir ?? join(homedir(), '.claude'), 'projects');

const readTail = (file: string, size: number): Record<string, any>[] => {
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8').split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line) as Record<string, any>];
    } catch {
      return [];
    }
  });
};

const clip = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
};

const promptText = (record: Record<string, any>): string | undefined => {
  if (record.type !== RecordType.USER || record.isMeta || record.isCompactSummary || record.isSidechain) return undefined;
  const content = record.message?.content;
  if (typeof content !== 'string' || content.startsWith('<')) return undefined;
  return content;
};

const answerText = (record: Record<string, any>): string | undefined => {
  if (record.type !== RecordType.ASSISTANT || record.isSidechain) return undefined;
  const blocks = Array.isArray(record.message?.content) ? (record.message.content as Record<string, any>[]) : [];
  const text = blocks.filter((block) => block.type === BlockType.TEXT && typeof block.text === 'string').map((block) => block.text as string).join('\n').trim();
  return text || undefined;
};

const scanFile = (file: string, project: string): ScannedType | undefined => {
  const stat = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.scanned;
  const records = readTail(file, stat.size);
  const last = [...records].reverse().find((record) => record.type === RecordType.ASSISTANT && !record.isSidechain && record.message?.usage);
  let scanned: ScannedType | undefined;
  if (last) {
    const usage = last.message.usage as Record<string, unknown>;
    const contextTokens = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
    const lastPrompt = [...records].reverse().find((record) => record.type === RecordType.LAST_PROMPT && typeof record.lastPrompt === 'string');
    const cwd = typeof last.cwd === 'string' ? last.cwd : '';
    scanned = {
      file,
      internal: last.entrypoint === SDK_ENTRYPOINT || project.includes(THQ_WORKTREE_MARK),
      sessionId: basename(file, TRANSCRIPT_EXT),
      cwd,
      project: cwd ? basename(cwd) : project,
      title: clip(lastPrompt?.lastPrompt ?? '', TITLE_LIMIT) || (cwd ? basename(cwd) : project),
      contextTokens,
      lastActiveAt: Date.parse(String(last.timestamp ?? '')) || stat.mtimeMs,
      large: false,
      cold: false,
    };
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, scanned });
  return scanned;
};

const scanAll = (claudeConfigDir: string | undefined, now: number): ScannedType[] => {
  const root = projectsDir(claudeConfigDir);
  if (!existsSync(root)) return [];
  const found: ScannedType[] = [];
  readdirSync(root).forEach((project) => {
    const dir = join(root, project);
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(TRANSCRIPT_EXT));
    } catch {
      return;
    }
    names.forEach((name) => {
      const file = join(dir, name);
      try {
        if (now - statSync(file).mtimeMs > MAX_AGE_HOURS * MS_PER_HOUR) return;
        const scanned = scanFile(file, project);
        if (scanned && !scanned.internal) found.push(scanned);
      } catch {
        return;
      }
    });
  });
  return found;
};

export const scanTerminalSessions = (claudeConfigDir: string | undefined, options: WatchOptionsType, now = Date.now()): TerminalSessionType[] =>
  scanAll(claudeConfigDir, now)
    .filter((session) => session.contextTokens >= Math.min(LIST_MIN_TOKENS, options.largeTokens))
    .map(({ file: _file, internal: _internal, ...session }) => ({
      ...session,
      large: session.contextTokens >= options.largeTokens,
      cold: now - session.lastActiveAt >= options.coldMinutes * MS_PER_MINUTE,
    }))
    .sort((a, b) => b.contextTokens - a.contextTokens)
    .slice(0, LIST_LIMIT);

export const terminalSessionRecap = (claudeConfigDir: string | undefined, sessionId: string): string => {
  const root = projectsDir(claudeConfigDir);
  if (!existsSync(root)) return '';
  const project = readdirSync(root).find((name) => existsSync(join(root, name, `${sessionId}${TRANSCRIPT_EXT}`)));
  if (!project) return '';
  const file = join(root, project, `${sessionId}${TRANSCRIPT_EXT}`);
  const exchanges: { asked: string; answer: string }[] = [];
  readTail(file, statSync(file).size).forEach((record) => {
    const asked = promptText(record);
    if (asked) {
      exchanges.push({ asked, answer: '' });
      return;
    }
    const answer = answerText(record);
    if (answer && exchanges.length > 0) exchanges[exchanges.length - 1].answer = answer;
  });
  return exchanges
    .filter((exchange) => exchange.answer)
    .slice(-RECAP_EXCHANGES)
    .map((exchange) => `User: ${clip(exchange.asked, RECAP_ASK_CHARS)}\nClaude: ${clip(exchange.answer, RECAP_ANSWER_CHARS)}`)
    .join('\n\n');
};
