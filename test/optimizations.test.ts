import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { autocompactWindow, toSession, toWatch, type ProfileConfigType } from '../src/main/config';
import { planClaudeRun } from '../src/main/guard';
import { UsageLedger } from '../src/main/ledger';
import { NoteReadLog } from '../src/main/noteReads';
import { isLookup, resolveModel } from '../src/main/routing';
import { ScheduleStore, nextRun } from '../src/main/schedules';
import { scanTerminalSessions, terminalSessionRecap } from '../src/main/sessionWatch';
import { listTemplates } from '../src/main/templates';
import { forecastLimitAt } from '../src/main/limits';
import type { CreatureType } from '@shared/types';

const DAY_MS = 86_400_000;

beforeEach(() => {
  process.env.THQ_HOME = mkdtempSync(join(tmpdir(), 'thq-opt-'));
});

describe('compaction window', () => {
  it('leaves room above the measured session floor', () => {
    expect(autocompactWindow(200_000, 54_000)).toBe(204_000);
    expect(autocompactWindow(120_000, 54_000)).toBe(204_000);
    expect(autocompactWindow(400_000, 54_000)).toBe(400_000);
    expect(autocompactWindow(200_000)).toBe(200_000);
  });

  it('stays inside what the CLI accepts and respects auto', () => {
    expect(autocompactWindow(900_000, 950_000)).toBe(1_000_000);
    expect(autocompactWindow(0, 54_000)).toBe(0);
  });
});

describe('watch and light model config', () => {
  it('defaults to watching terminal sessions at 300k', () => {
    expect(toWatch(undefined)).toEqual({ terminalSessions: true, largeTokens: 300_000, notify: true });
    expect(toWatch({ terminalSessions: false, largeTokens: 10, notify: false })).toEqual({ terminalSessions: false, largeTokens: 50_000, notify: false });
  });

  it('lets the light model be turned off', () => {
    expect(toSession({ lightModel: '' }).lightModel).toBe('');
  });
});

describe('planClaudeRun context', () => {
  const profile = {
    vault: '/nonexistent/vault',
    guard: { fullAutoMaxMinutes: 45, fullAutoMaxPlanUsage: 0.85, fullAutoWorktree: true, alwaysDeny: [] },
    session: { autocompactTokens: 200_000, idleResetMinutes: 60, idleResetMinTokens: 40_000, fallbackModel: 'sonnet', lightModel: 'sonnet' },
  } as unknown as ProfileConfigType;
  const creature = {
    id: 'scout', name: 'Scout', role: 'r', blurb: '', engine: 'claude', autonomy: 'ask',
    dir: '/nonexistent/creature', addDirs: [], brain: [], skills: [], tools: { allow: ['Read', 'Artifact', 'ArtifactData'], ask: [], deny: [] },
  } as unknown as CreatureType;
  const bridge = { serverScript: 's', nodeBinary: 'n', port: 1, token: 't', questId: 'q' };
  const allowed = (args: string[]): string[] => args.slice(args.indexOf('--allowedTools') + 1);

  it('keeps everything by default', () => {
    const { args } = planClaudeRun({ creature, profile, systemPrompt: 'hi', bridge, questId: 'quest-1234' });
    expect(args).not.toContain('--disable-slash-commands');
    expect(args).not.toContain('--strict-mcp-config');
    expect(allowed(args)).toContain('Artifact');
  });

  it('drops what a lean creature does not load and widens the compaction window', () => {
    const { args } = planClaudeRun({
      creature, profile, systemPrompt: 'hi', bridge, questId: 'quest-1234',
      context: { artifacts: false, slashCommands: false, connectors: false },
      floorTokens: 80_000,
    });
    expect(args).toEqual(expect.arrayContaining(['--disable-slash-commands', '--strict-mcp-config', '--autocompact', '230000']));
    expect(allowed(args)).not.toContain('Artifact');
    expect(allowed(args)).not.toContain('ArtifactData');
    expect(allowed(args)).toContain('Read');
  });
});

describe('model routing', () => {
  it('recognises short questions and leaves work alone', () => {
    expect(isLookup('where is the delivery window calculated?')).toBe(true);
    expect(isLookup('how is request_summary used in app?')).toBe(true);
    expect(isLookup('can you fix the overlap on the tracking header')).toBe(false);
    expect(isLookup('what does /Users/me/app/src/index.ts do')).toBe(false);
    expect(isLookup('/compact')).toBe(false);
    expect(isLookup(`what is this ${'x'.repeat(400)}`)).toBe(false);
  });

  const base = { prompt: 'where is the delivery window calculated?', lightModel: 'sonnet', resumed: false } as const;

  it('answers a teammate on the light model unless the creature is already light', () => {
    expect(resolveModel({ ...base, kind: 'handoff', model: undefined })).toEqual({ model: 'sonnet', routed: true });
    expect(resolveModel({ ...base, kind: 'handoff', model: 'opus' })).toEqual({ model: 'sonnet', routed: true });
    expect(resolveModel({ ...base, kind: 'handoff', model: 'haiku' })).toEqual({ model: 'haiku', routed: false });
  });

  it('routes lookups only for creatures on Auto', () => {
    expect(resolveModel({ ...base, kind: 'chat', model: 'auto' })).toEqual({ model: 'sonnet', routed: true });
    expect(resolveModel({ ...base, kind: 'chat', model: 'opus' })).toEqual({ model: 'opus', routed: false });
    expect(resolveModel({ ...base, kind: 'chat', model: 'auto', prompt: 'implement the new banner' })).toEqual({ model: undefined, routed: false });
  });

  it('does not switch model inside a session that is already on the heavy one', () => {
    expect(resolveModel({ ...base, kind: 'chat', model: 'auto', resumed: true, sessionModel: 'claude-opus-5-5' })).toEqual({ model: undefined, routed: false });
    expect(resolveModel({ ...base, kind: 'chat', model: 'auto', resumed: true, sessionModel: 'claude-sonnet-5-5' })).toEqual({ model: 'sonnet', routed: true });
  });

  it('does nothing when the light model is turned off', () => {
    expect(resolveModel({ ...base, kind: 'handoff', model: 'auto', lightModel: '' })).toEqual({ model: undefined, routed: false });
  });
});

describe('usage ledger', () => {
  const usage = { inputTokens: 100, outputTokens: 400, cacheReadTokens: 9_000, cacheWriteTokens: 500, costUsd: 1.5, compactions: 2 };
  const creatures = [{ id: 'scout', weeklyBudgetUsd: 5 }, { id: 'sage' }] as unknown as CreatureType[];

  it('adds up runs per creature and reports the week against the budget', () => {
    const ledger = new UsageLedger();
    ledger.load('main');
    const now = Date.now();
    ledger.record('scout', { usage, handoff: false, freshSession: true, coldReset: false }, now);
    ledger.record('scout', { usage, handoff: true, freshSession: false, coldReset: true }, now - 2 * DAY_MS);
    ledger.record('scout', { usage, handoff: false, freshSession: false, coldReset: false }, now - 20 * DAY_MS);
    const report = ledger.report(creatures, 30, now);
    const scout = report.creatures.find((row) => row.creatureId === 'scout');
    expect(scout).toMatchObject({ quests: 3, handoffs: 1, freshTokens: 3_000, cacheReadTokens: 27_000, costUsd: 4.5, compactions: 6, freshSessions: 1, coldResets: 1, weekCostUsd: 3, weeklyBudgetUsd: 5 });
    expect(ledger.spentSince('scout', 7, now)).toBe(3);
    expect(report.byDay).toHaveLength(30);
    expect(report.byDay[29].costUsd).toBe(1.5);
  });

  it('writes pending spend at once on flush, and keeps it across a reload', () => {
    const ledger = new UsageLedger();
    ledger.load('flushed');
    ledger.record('scout', { usage, handoff: false, freshSession: false, coldReset: false });
    ledger.flush();
    const reloaded = new UsageLedger();
    reloaded.load('flushed');
    expect(reloaded.spentSince('scout', 7)).toBe(1.5);
  });

  it('lists a budgeted creature before it has run anything', () => {
    const ledger = new UsageLedger();
    ledger.load('main');
    expect(ledger.report(creatures).creatures.map((row) => row.creatureId)).toEqual(['scout']);
  });
});

describe('recurring quests', () => {
  const at = (day: number, hour: number, minute = 0): number => new Date(2026, 10, day, hour, minute, 0, 0).getTime();

  it('finds the next slot for each cadence', () => {
    expect(nextRun({ cadence: 'hourly', hour: 0, minute: 15, weekday: 0 }, at(13, 10, 20))).toBe(at(13, 11, 15));
    expect(nextRun({ cadence: 'daily', hour: 9, minute: 0, weekday: 0 }, at(13, 8))).toBe(at(13, 9));
    expect(nextRun({ cadence: 'daily', hour: 9, minute: 0, weekday: 0 }, at(13, 9))).toBe(at(14, 9));
    expect(nextRun({ cadence: 'weekdays', hour: 9, minute: 0, weekday: 0 }, at(13, 10))).toBe(at(16, 9));
    expect(nextRun({ cadence: 'weekly', hour: 9, minute: 30, weekday: 3 }, at(13, 10))).toBe(at(18, 9, 30));
  });

  it('saves, comes due once and moves on after running', () => {
    const store = new ScheduleStore();
    store.load('main');
    const id = store.save({ creatureId: 'scout', prompt: ' check numbers ', cadence: 'daily', hour: 9, minute: 0, weekday: 1, enabled: true }, at(13, 8));
    expect(store.get(id)?.prompt).toBe('check numbers');
    expect(store.due(at(13, 8, 30))).toHaveLength(0);
    expect(store.due(at(13, 9, 1)).map((schedule) => schedule.id)).toEqual([id]);
    store.markRan(id, at(13, 9, 1));
    expect(store.due(at(13, 9, 2))).toHaveLength(0);
    expect(store.get(id)?.nextRunAt).toBe(at(14, 9));
    store.save({ ...store.get(id)!, enabled: false }, at(13, 9, 2));
    expect(store.due(at(15, 9))).toHaveLength(0);
    const reloaded = new ScheduleStore();
    reloaded.load('main');
    expect(reloaded.list()).toHaveLength(1);
    expect(() => store.save({ creatureId: 'scout', prompt: '  ', cadence: 'daily', hour: 9, minute: 0, weekday: 1, enabled: true })).toThrow();
  });
});

describe('brain note reads', () => {
  it('flags notes that are large, stale or never read once tracking is old enough', () => {
    const vault = mkdtempSync(join(tmpdir(), 'thq-vault-'));
    const core = join(vault, 'core.md');
    const big = join(vault, 'big.md');
    const old = join(vault, 'old.md');
    writeFileSync(core, 'core');
    writeFileSync(big, 'x'.repeat(25_000));
    writeFileSync(old, 'old');
    const longAgo = new Date(Date.now() - 120 * DAY_MS);
    utimesSync(old, longAgo, longAgo);
    const log = new NoteReadLog();
    log.load('main');
    log.record(big);
    log.record(big);
    log.record(join(vault, 'not-a-note.txt'));
    const fresh = log.health([core, big, old], [core], vault);
    expect(fresh.notes.find((note) => note.label === 'big.md')).toMatchObject({ reads: 2, flags: ['large'] });
    expect(fresh.notes.find((note) => note.label === 'core.md')?.flags).toEqual(['inline']);
    expect(fresh.notes.find((note) => note.label === 'old.md')?.flags).toEqual(['stale']);
    const later = log.health([core, big, old], [core], vault, Date.now() + 8 * DAY_MS);
    expect(later.notes.find((note) => note.label === 'old.md')?.flags).toEqual(['never-read', 'stale']);
  });
});

describe('terminal session watch', () => {
  const line = (record: Record<string, unknown>): string => JSON.stringify(record);
  const assistant = (tokens: number, text: string, entrypoint: string, timestamp: string) => ({
    type: 'assistant', entrypoint, cwd: '/code/my-app', timestamp,
    message: { content: [{ type: 'text', text }], usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 } },
  });

  it('lists large terminal sessions, skips creature runs and recaps the last exchanges', () => {
    const config = mkdtempSync(join(tmpdir(), 'thq-claude-'));
    const project = join(config, 'projects', '-code-my-app');
    mkdirSync(project, { recursive: true });
    const now = Date.now();
    const recent = new Date(now - 5 * 60_000).toISOString();
    const hoursAgo = new Date(now - 3 * 3_600_000).toISOString();
    writeFileSync(join(project, 'big.jsonl'), [
      line({ type: 'user', message: { role: 'user', content: 'why is the header overlapping?' } }),
      line(assistant(200_000, 'The title has no max width.', 'cli', recent)),
      line({ type: 'user', message: { role: 'user', content: '<system-reminder>ignored</system-reminder>' } }),
      line({ type: 'user', message: { role: 'user', content: 'fix it please' } }),
      line(assistant(412_000, 'Fixed in NoonHeader.tsx.', 'cli', recent)),
      line({ type: 'last-prompt', lastPrompt: 'fix it please' }),
    ].join('\n'));
    writeFileSync(join(project, 'cold.jsonl'), line(assistant(150_000, 'Done.', 'cli', hoursAgo)));
    writeFileSync(join(project, 'small.jsonl'), line(assistant(20_000, 'Done.', 'cli', recent)));
    writeFileSync(join(project, 'creature.jsonl'), line(assistant(500_000, 'Done.', 'sdk-cli', recent)));
    const sessions = scanTerminalSessions(config, { largeTokens: 300_000, coldMinutes: 60 }, now);
    expect(sessions.map((session) => session.sessionId)).toEqual(['big', 'cold']);
    expect(sessions[0]).toMatchObject({ title: 'fix it please', project: 'my-app', cwd: '/code/my-app', contextTokens: 412_002, large: true, cold: false });
    expect(sessions[1]).toMatchObject({ large: false, cold: true });
    expect(terminalSessionRecap(config, 'big')).toBe('User: why is the header overlapping?\nClaude: The title has no max width.\n\nUser: fix it please\nClaude: Fixed in NoonHeader.tsx.');
    expect(terminalSessionRecap(config, 'missing')).toBe('');
  });
});

describe('quest templates', () => {
  it('reads templates from the vault with their description and prompt', () => {
    const vault = mkdtempSync(join(tmpdir(), 'thq-vault-'));
    mkdirSync(join(vault, 'templates'));
    writeFileSync(join(vault, 'templates', 'qa-guide.md'), '---\ndescription: Testing guide\n---\nWrite a testing guide.\n');
    writeFileSync(join(vault, 'templates', 'plain.md'), 'Just a prompt.');
    writeFileSync(join(vault, 'templates', 'empty.md'), '---\ndescription: nothing\n---\n');
    expect(listTemplates(vault)).toEqual([
      { name: 'plain', description: '', kind: 'template', prompt: 'Just a prompt.' },
      { name: 'qa-guide', description: 'Testing guide', kind: 'template', prompt: 'Write a testing guide.' },
    ]);
    expect(listTemplates(join(vault, 'missing'))).toEqual([]);
  });
});

describe('plan limit forecast', () => {
  const MIN = 60_000;
  const now = 1_000 * MIN;

  it('projects when the window runs out from the recent climb', () => {
    const samples = [{ at: now - 30 * MIN, fiveHour: 0.4 }, { at: now, fiveHour: 0.6 }];
    expect(forecastLimitAt(samples, now + 120 * MIN, now)).toBe(now + 60 * MIN);
  });

  it('says nothing when the reset comes first, usage is flat, or there is too little to go on', () => {
    const climbing = [{ at: now - 30 * MIN, fiveHour: 0.4 }, { at: now, fiveHour: 0.6 }];
    expect(forecastLimitAt(climbing, now + 30 * MIN, now)).toBeUndefined();
    expect(forecastLimitAt([{ at: now - 30 * MIN, fiveHour: 0.5 }, { at: now, fiveHour: 0.5 }], undefined, now)).toBeUndefined();
    expect(forecastLimitAt([{ at: now - 2 * MIN, fiveHour: 0.2 }, { at: now, fiveHour: 0.5 }], undefined, now)).toBeUndefined();
    expect(forecastLimitAt([{ at: now - 120 * MIN, fiveHour: 0.1 }, { at: now, fiveHour: 0.5 }], undefined, now)).toBeUndefined();
  });
});
