import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuestStatus } from '@shared/constants';
import type { AppStateType } from '@shared/types';

const FAKE = resolve(__dirname, 'fixtures/fake-claude.mjs');
const root = mkdtempSync(join(tmpdir(), 'thq-backup-'));
const vault = join(root, 'vault');
const mainDir = join(root, 'main-account');
const backupDir = join(root, 'backup-account');
const log = join(root, 'runs.jsonl');

type HqType = InstanceType<typeof import('../src/main/hq').Hq>;
let hq: HqType;

const runs = (): { account: string; resume: string | null }[] =>
  readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

const settled = async (state: () => AppStateType, count: number): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    const chats = state().quests.filter((quest) => quest.creatureId === 'scout');
    if (chats.length >= count && chats.every((quest) => quest.status !== QuestStatus.RUNNING)) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('quests never settled');
};

beforeAll(async () => {
  process.env.THQ_HOME = join(root, 'home');
  process.env.FAKE_LOG = log;
  process.env.FAKE_LIMITED_CONFIG_DIR = mainDir;
  process.env.FAKE_SESSION_BY_ACCOUNT = '1';
  writeFileSync(log, '');
  [mainDir, backupDir, process.env.THQ_HOME].forEach((dir) => mkdirSync(dir, { recursive: true }));
  mkdirSync(join(vault, 'party'), { recursive: true });
  cpSync(resolve(__dirname, '../vault-template/party/scout'), join(vault, 'party/scout'), { recursive: true });
  writeFileSync(join(vault, 'profile.yaml'), [
    'name: Test',
    `claudeConfigDir: ${mainDir}`,
    `limitFallbackConfigDir: ${backupDir}`,
    'engines:',
    '  claude:',
    '    adapter: claude',
    `    bin: ${FAKE}`,
    '',
  ].join('\n'));
  writeFileSync(join(process.env.THQ_HOME, 'profiles.yaml'), `active: test\nprofiles:\n  test:\n    vault: ${vault}\n`);
  const { Hq } = await import('../src/main/hq');
  hq = new Hq();
  await hq.start();
});

afterAll(() => {
  hq?.stop();
  delete process.env.FAKE_LIMITED_CONFIG_DIR;
  delete process.env.FAKE_SESSION_BY_ACCOUNT;
  delete process.env.FAKE_LOG;
});

describe('backup account at the plan limit', () => {
  it('sends a limited chat again on the backup account, then keeps resuming there', async () => {
    hq.chat({ creatureId: 'scout', text: 'first question' });
    await settled(() => hq.getState(), 2);
    expect(runs()).toEqual([
      { account: 'main-account', resume: null },
      { account: 'backup-account', resume: null },
    ]);
    const state = hq.getState();
    expect(state.backupAccountUntil).toBeGreaterThan(Date.now());
    const [retry, limited] = state.quests.filter((quest) => quest.creatureId === 'scout');
    expect(limited.status).toBe(QuestStatus.PAUSED);
    expect(limited.events.some((event) => event.text.includes('backup Claude account'))).toBe(true);
    expect(retry.status).toBe(QuestStatus.DONE);
    expect(retry.sessionId).toBe('backup:sess-backup-account');

    hq.chat({ creatureId: 'scout', text: 'second question' });
    await settled(() => hq.getState(), 3);
    expect(runs()[2]).toEqual({ account: 'backup-account', resume: 'sess-backup-account' });
  });

  it('goes back to the main account in a fresh session once its limit has reset', async () => {
    delete process.env.FAKE_LIMITED_CONFIG_DIR;
    // Stand-in for the clock passing the main account's reset time.
    (hq as unknown as { mainLimitedUntil: number }).mainLimitedUntil = 0;
    hq.chat({ creatureId: 'scout', text: 'third question' });
    await settled(() => hq.getState(), 4);
    expect(runs()[3]).toEqual({ account: 'main-account', resume: null });
    const [latest] = hq.getState().quests;
    expect(latest.sessionId).toBe('sess-main-account');
    expect(latest.events.some((event) => event.text.includes('Back on your main Claude account'))).toBe(true);
    expect(hq.getState().backupAccountUntil).toBeUndefined();
  });
});
