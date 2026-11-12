import { describe, expect, it } from 'vitest';
import { QuestKind, QuestStatus } from '../src/shared/constants';
import type { QuestType } from '../src/shared/types';
import { questUsageSummary } from '../src/renderer/src/lib/format';

const quest = (freshSession: boolean, cacheWriteTokens: number): QuestType => ({
  id: 'q',
  creatureId: 'c',
  kind: QuestKind.CHAT,
  title: 't',
  status: QuestStatus.DONE,
  startedAt: 0,
  events: [],
  freshSession,
  usage: { inputTokens: 10, outputTokens: 500, cacheReadTokens: 40_000, cacheWriteTokens },
});

describe('questUsageSummary', () => {
  it('labels and explains a new session\'s one-time setup without flagging it', () => {
    const summary = questUsageSummary(quest(true, 50_000));
    expect(summary?.label).toContain('(incl. setup)');
    expect(summary?.detail).toMatch(/^New session/);
    expect(summary?.expensive).toBe(false);
  });

  it('still flags the same amount on a resumed session', () => {
    const summary = questUsageSummary(quest(false, 50_000));
    expect(summary?.label).not.toContain('setup');
    expect(summary?.expensive).toBe(true);
  });
});
