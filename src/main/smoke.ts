import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app, type BrowserWindow } from 'electron';
import { QuestStatus } from '@shared/constants';
import type { AppStateType, ChatRequestType } from '@shared/types';

const SMOKE_DELAY_MS = 7000;
const FRAME_ACTION_NOTCH = 'open';
const CHAT_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;
const LIVE = new Set<string>([QuestStatus.RUNNING, QuestStatus.WAITING]);

type SmokeHostType = {
  windows: () => [string, BrowserWindow][];
  state: () => AppStateType;
  chat: (request: ChatRequestType) => string;
  openNotch: () => void;
  openView: (view: string) => void;
  openNotchAnimated: () => void;
  cancel: (questId: string) => void;
};

const runChat = async (host: SmokeHostType, spec: string): Promise<Record<string, unknown>> => {
  const [creatureId, ...rest] = spec.split(':');
  const questId = host.chat({ creatureId, text: rest.join(':') });
  const started = Date.now();
  while (Date.now() - started < CHAT_TIMEOUT_MS) {
    const quest = host.state().quests.find((entry) => entry.id === questId);
    if (quest && !LIVE.has(quest.status)) {
      const last = quest.events[quest.events.length - 1];
      return { status: quest.status, seconds: Math.round((Date.now() - started) / 1000), events: quest.events.length, last: last?.text.slice(0, 300) };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { status: 'timeout' };
};

export const runSmokeIfRequested = (host: SmokeHostType): void => {
  const dir = process.env.THQ_SMOKE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  setTimeout(async () => {
    host.windows().forEach(([, win]) => win.webContents.setBackgroundThrottling(false));
    let pendingQuest: string | undefined;
    if (process.env.THQ_SMOKE_CHAT_NOWAIT) {
      const [creatureId, ...rest] = process.env.THQ_SMOKE_CHAT_NOWAIT.split(':');
      pendingQuest = host.chat({ creatureId, text: rest.join(':') });
      const started = Date.now();
      while (Date.now() - started < CHAT_TIMEOUT_MS && host.state().approvals.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    const chat = process.env.THQ_SMOKE_CHAT ? await runChat(host, process.env.THQ_SMOKE_CHAT) : undefined;
    if (chat) await new Promise((resolve) => setTimeout(resolve, 1500));
    if (process.env.THQ_SMOKE_VIEW) {
      host.openView(process.env.THQ_SMOKE_VIEW);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    for (const spec of (process.env.THQ_SMOKE_FRAMES ?? '').split(',').filter(Boolean)) {
      const [label, count, interval, action] = spec.split(':');
      const win = host.windows().find(([name]) => name === label)?.[1];
      if (!win) continue;
      const framesDir = join(dir, 'frames', `${label}${action ? `-${action}` : ''}`);
      mkdirSync(framesDir, { recursive: true });
      if (action === FRAME_ACTION_NOTCH) host.openNotchAnimated();
      for (let index = 0; index < Number(count); index += 1) {
        const image = await win.webContents.capturePage();
        writeFileSync(join(framesDir, `${String(index).padStart(3, '0')}.png`), image.toPNG());
        await new Promise((resolve) => setTimeout(resolve, Number(interval)));
      }
    }
    if (process.env.THQ_SMOKE_NOTCH_OPEN) {
      host.openNotch();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    for (const [label, win] of host.windows()) {
      const image = await win.webContents.capturePage();
      writeFileSync(join(dir, `${label}.png`), image.toPNG());
    }
    if (pendingQuest) host.cancel(pendingQuest);
    const snapshot = host.state();
    process.stdout.write(`${JSON.stringify({
      profile: snapshot.profile.name,
      creatures: snapshot.creatures.map((creature) => `${creature.id}:${creature.autonomy}`),
      repos: snapshot.repos,
      engines: snapshot.engines,
      errors: snapshot.errors,
      auth: snapshot.auth ? { loggedIn: snapshot.auth.loggedIn, plan: snapshot.auth.plan, error: snapshot.auth.error } : 'pending',
      usage: snapshot.usage,
      chat,
      bounds: Object.fromEntries(host.windows().map(([label, win]) => [label, win.getBounds()])),
    })}\n`);
    app.quit();
  }, SMOKE_DELAY_MS);
};
