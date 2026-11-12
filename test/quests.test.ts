import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuestStore } from '../src/main/quests';

let store: QuestStore;

beforeEach(() => {
  process.env.THQ_HOME = mkdtempSync(join(tmpdir(), 'thq-test-'));
  store = new QuestStore(() => undefined);
  store.load('main');
});

const chat = (text: string, answer: string, sessionId: string) => {
  const quest = store.create('scout', 'chat', text);
  store.addEvent(quest.id, { kind: 'user', text });
  store.addEvent(quest.id, { kind: 'text', text: answer });
  store.setSession(quest.id, sessionId);
  return quest;
};

describe('QuestStore session helpers', () => {
  it('recaps the last exchanges of a session in order', () => {
    chat('one', 'first answer', 's1');
    chat('two', 'second answer', 's1');
    chat('other', 'not this session', 's2');
    expect(store.recap('s1')).toBe('User: one\nYou: first answer\n\nUser: two\nYou: second answer');
  });

  it('keeps the recap short', () => {
    chat('q', 'x'.repeat(5_000), 's1');
    expect(store.recap('s1').length).toBeLessThan(2_200);
  });

  it('reports when a session was last used and how big it was', () => {
    const quest = chat('q', 'a', 's1');
    store.setUsage(quest.id, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 90_000 });
    store.setStatus(quest.id, 'done');
    const activity = store.sessionActivity('s1');
    expect(activity?.contextTokens).toBe(90_000);
    expect(Date.now() - (activity?.at ?? 0)).toBeLessThan(5_000);
    expect(store.sessionActivity('missing')).toBeUndefined();
  });

  it('estimates a session\'s size from what each reply sent and received', () => {
    const first = chat('q1', 'a', 'agy:c1');
    const second = chat('q2', 'b', 'agy:c1');
    chat('other', 'c', 'agy:c2');
    store.setUsage(first.id, { inputTokens: 6_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
    store.setUsage(second.id, { inputTokens: 200, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(store.sessionTokenEstimate('agy:c1')).toBe(8_000);
  });
});
