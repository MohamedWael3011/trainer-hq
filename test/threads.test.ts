import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuestStore } from '../src/main/quests';
import { ThreadStore, threadTitle } from '../src/main/threads';

let quests: QuestStore;
let threads: ThreadStore;

beforeEach(() => {
  process.env.THQ_HOME = mkdtempSync(join(tmpdir(), 'thq-test-'));
  quests = new QuestStore(() => undefined);
  quests.load('main');
  threads = new ThreadStore();
  threads.load('main');
});

const say = (text: string, sessionId: string, threadId?: string) => {
  const quest = quests.create('scout', 'chat', text, undefined, undefined, undefined, threadId);
  quests.setSession(quest.id, sessionId);
  return quest;
};

describe('clearing a chat into history', () => {
  it('moves the chat and its session to the stash thread and leaves other chats alone', () => {
    const first = say('plan the release', 's-main');
    const other = say('review the PR', 's-thread', 'abc');
    const stash = threads.add({ creatureId: 'scout', title: 'plan the release', kind: 'cleared', archived: true });

    expect(quests.moveChat('scout', undefined, stash.id)).toEqual([first.id]);

    expect(quests.get(first.id)?.threadId).toBe(stash.id);
    expect(quests.get(other.id)?.threadId).toBe('abc');
    expect(quests.sessionFor('scout')).toBeUndefined();
    expect(quests.sessionFor(`scout:${stash.id}`)).toBe('s-main');
    expect(quests.sessionFor('scout:abc')).toBe('s-thread');
  });

  it('reopens a cleared chat as a normal thread', () => {
    const stash = threads.add({ creatureId: 'scout', title: 'old chat', kind: 'cleared', archived: true });
    expect(stash.archived).toBe(true);
    expect(stash.archivedAt).toBeDefined();

    threads.restore(stash.id);

    expect(threads.get(stash.id)).toMatchObject({ archived: false, kind: 'chat', archivedAt: undefined });
  });

  it('survives a reload and deletes for good', () => {
    const stash = threads.add({ creatureId: 'scout', title: 'old chat', kind: 'cleared', archived: true });
    const reloaded = new ThreadStore();
    reloaded.load('main');
    expect(reloaded.get(stash.id)?.title).toBe('old chat');

    reloaded.remove(stash.id, undefined);
    expect(reloaded.list()).toEqual([]);
  });
});

describe('threadTitle', () => {
  it('flattens, clips, and falls back when empty', () => {
    expect(threadTitle('  daily\nmetrics  check ', 'x')).toBe('daily metrics check');
    expect(threadTitle('a'.repeat(80), 'x')).toBe(`${'a'.repeat(48)}…`);
    expect(threadTitle('   ', 'Recurring quest')).toBe('Recurring quest');
  });
});
