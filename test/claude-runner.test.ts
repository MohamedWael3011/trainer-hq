import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { runClaude } from '../src/main/engines/claude';
import { claudeFlagSupport, resetFlagSupport } from '../src/main/engines/claudeFlags';
import type { QuestEventType, QuestLiveType } from '@shared/types';

const FAKE = resolve(__dirname, 'fixtures/fake-claude.mjs');

const start = (env: Record<string, string> = {}) => {
  resetFlagSupport();
  const events: Omit<QuestEventType, 'at'>[] = [];
  const lives: QuestLiveType[] = [];
  const handle = runClaude({
    bin: FAKE,
    args: ['-p', '--output-format', 'stream-json'],
    prompt: 'first',
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    callbacks: { onEvent: (event) => events.push(event), onLive: (live) => lives.push(live) },
  });
  return { handle, events, lives };
};

describe('claudeFlagSupport', () => {
  it('reads supported options from --help', () => {
    resetFlagSupport();
    const supports = claudeFlagSupport(FAKE, { ...process.env, FAKE_HELP_FLAGS: '--resume,--model' });
    expect(supports('--resume')).toBe(true);
    expect(supports('--autocompact')).toBe(false);
  });

  it('sees options listed past the first 8 KB of a long help text', () => {
    resetFlagSupport();
    const supports = claudeFlagSupport(FAKE, process.env);
    expect(supports('--input-format')).toBe(true);
    expect(supports('--name')).toBe(true);
  });

  it('assumes a current CLI when --help cannot be read', () => {
    resetFlagSupport();
    expect(claudeFlagSupport('/nonexistent/claude', process.env)('--autocompact')).toBe(true);
  });
});

describe('runClaude', () => {
  it('streams live status, keeps helper text out of the reply and reports compaction', async () => {
    const { handle, events, lives } = start();
    const outcome = await handle.done;
    expect(outcome.ok).toBe(true);
    expect(events).toContainEqual({ kind: 'tool', text: 'Bash echo hi' });
    expect(events).toContainEqual({ kind: 'tool', text: '↳ Grep config' });
    expect(events.some((event) => event.text.includes('helper says hi'))).toBe(false);
    expect(events).toContainEqual({ kind: 'system', text: 'Auto-compacted the conversation: 160k → 22k tokens.' });
    expect(lives.some((live) => live.agents.includes('Find the config'))).toBe(true);
    expect(lives.some((live) => live.draft === 'Hello from fake.')).toBe(true);
    expect(lives[lives.length - 1].draft).toBe('');
    expect(lives[lives.length - 1].outputTokens).toBe(50);
    expect(outcome.usage?.contextTokens).toBe(22_105);
  });

  it('hands a follow-up to the running task, then refuses input once the reply is done', async () => {
    const { handle } = start({ FAKE_TOOL_MS: '300' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handle.send?.('second')).toBe(true);
    const outcome = await handle.done;
    expect(outcome.resultText).toBe('Heard: first | second');
    expect(handle.send?.('too late')).toBe(false);
  });

  it('falls back to a plain prompt on a CLI without stream input', async () => {
    const { handle } = start({ FAKE_HELP_FLAGS: '--resume' });
    expect(handle.send?.('second')).toBe(false);
    const outcome = await handle.done;
    expect(outcome.ok).toBe(true);
  });
});
