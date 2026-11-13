import { describe, expect, it } from 'vitest';
import { fallbackModel, planClaudeRun } from '../src/main/guard';
import type { ProfileConfigType } from '../src/main/config';
import type { CreatureType } from '@shared/types';

const profile = {
  vault: '/nonexistent/vault',
  guard: { fullAutoMaxMinutes: 45, fullAutoMaxPlanUsage: 0.85, fullAutoWorktree: true, fullAutoMaxBudgetUsd: 5, alwaysDeny: [] },
  session: { autocompactTokens: 120_000, idleResetMinutes: 60, idleResetMinTokens: 40_000, fallbackModel: 'sonnet' },
} as unknown as ProfileConfigType;

const creature = {
  id: 'scout', name: 'Scout', role: 'r', blurb: '', engine: 'claude', autonomy: 'full-auto', effort: 'medium',
  dir: '/nonexistent/creature', addDirs: [], brain: [], skills: [], tools: { allow: ['Read'], ask: [], deny: [] },
} as unknown as CreatureType;

const bridge = { serverScript: 's', nodeBinary: 'n', port: 1, token: 't', questId: 'q' };
const plan = (supports?: (flag: string) => boolean) =>
  planClaudeRun({ creature, profile, systemPrompt: 'hi', bridge, questId: 'quest-1234', supports, sessionName: 'Scout · Main' }).args;

describe('planClaudeRun', () => {
  it('passes the token-saving flags on a current CLI', () => {
    const args = plan();
    expect(args).toEqual(expect.arrayContaining(['--autocompact', '120000', '--effort', 'medium', '--fallback-model', 'sonnet', '--name', 'Scout · Main', '--max-budget-usd', '5', '--exclude-dynamic-system-prompt-sections']));
  });

  it('drops options an older CLI does not know, so the run still starts', () => {
    const args = plan(() => false);
    ['--autocompact', '--effort', '--fallback-model', '--name', '--max-budget-usd', '--exclude-dynamic-system-prompt-sections'].forEach((flag) => expect(args).not.toContain(flag));
    expect(args).toContain('--append-system-prompt');
  });
});

describe('creature limits', () => {
  const limited = { ...creature, tools: { allow: ['Read'], ask: ['Bash(git commit:*)'], deny: ['Write'] } } as unknown as CreatureType;
  const argsFor = (askBeyondLimits: boolean, supports?: (flag: string) => boolean) =>
    planClaudeRun({
      creature: limited,
      profile: { ...profile, guard: { ...profile.guard, alwaysDeny: ['Bash(sudo:*)'], askBeyondLimits } } as unknown as ProfileConfigType,
      systemPrompt: 'hi', bridge, questId: 'quest-1234', supports,
    }).args;
  const askRules = (args: string[]) => JSON.parse(args[args.indexOf('--settings') + 1]).permissions.ask;
  const denyRules = (args: string[]) => args.slice(args.indexOf('--disallowedTools') + 1).filter((arg, index, rest) => !rest.slice(0, index + 1).includes('--settings') && rest[index - 1] !== '--settings');

  it('refuses what the creature denies by default, and still asks for its ask rules', () => {
    const args = argsFor(false);
    expect(denyRules(args)).toEqual(['Bash(sudo:*)', 'Write']);
    expect(askRules(args)).toEqual(['Bash(git commit:*)']);
  });

  it('asks instead of refusing anything when the profile says so', () => {
    const args = argsFor(true);
    expect(args).not.toContain('--disallowedTools');
    expect(askRules(args)).toEqual(['Bash(git commit:*)', 'Bash(sudo:*)', 'Write']);
  });

  it('keeps refusing on a CLI that cannot take ask rules', () => {
    const args = argsFor(true, () => false);
    expect(denyRules(args)).toEqual(['Bash(sudo:*)', 'Write']);
    expect(args).not.toContain('--settings');
  });
});

describe('fallbackModel', () => {
  it('falls back to the lighter model only from heavier ones', () => {
    expect(fallbackModel(undefined, 'sonnet')).toBe('sonnet');
    expect(fallbackModel('opus', 'sonnet')).toBe('sonnet');
    expect(fallbackModel('claude-sonnet-5-5', 'sonnet')).toBeUndefined();
    expect(fallbackModel('haiku', 'sonnet')).toBeUndefined();
    expect(fallbackModel('opus', '')).toBeUndefined();
  });
});
