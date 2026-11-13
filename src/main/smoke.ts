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
      // Several messages separated by "||" go out one after another, e.g. to see what queues behind a running reply.
      for (const message of process.env.THQ_SMOKE_CHAT_NOWAIT.split('||')) {
        const [creatureId, ...rest] = message.split(':');
        pendingQuest ??= host.chat({ creatureId, text: rest.join(':') });
        if (pendingQuest && message !== process.env.THQ_SMOKE_CHAT_NOWAIT.split('||')[0]) host.chat({ creatureId, text: rest.join(':') });
        await new Promise((resolve) => setTimeout(resolve, 700));
        // THQ_SMOKE_SCROLL_TOP: scroll the chat up after the first message, as if reading back.
        if (process.env.THQ_SMOKE_SCROLL_TOP && message === process.env.THQ_SMOKE_CHAT_NOWAIT.split('||')[0]) {
          await host.windows().find(([name]) => name === 'dashboard')?.[1].webContents.executeJavaScript("(() => { const log = document.querySelector('.party-log'); log?.scrollTo(0, 0); return JSON.stringify([log?.scrollTop, log?.scrollHeight, log?.clientHeight]); })()").then((info) => process.stdout.write(`scroll ${info}\n`));
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      const started = Date.now();
      // THQ_SMOKE_NOWAIT_MS captures a reply mid-stream instead of waiting for an approval.
      const waitMs = Number(process.env.THQ_SMOKE_NOWAIT_MS) > 0 ? Number(process.env.THQ_SMOKE_NOWAIT_MS) : CHAT_TIMEOUT_MS;
      while (Date.now() - started < waitMs && host.state().approvals.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    if (process.env.THQ_SMOKE_SCROLL_TOP) {
      const info = await host.windows().find(([name]) => name === 'dashboard')?.[1].webContents.executeJavaScript("(() => { const log = document.querySelector('.party-log'); return JSON.stringify([log?.scrollTop, log?.scrollHeight, log?.clientHeight, !!document.querySelector('.party-jump')]); })()");
      process.stdout.write(`scroll-after ${info}\n`);
    }
    const chat = process.env.THQ_SMOKE_CHAT ? await runChat(host, process.env.THQ_SMOKE_CHAT) : undefined;
    if (chat) await new Promise((resolve) => setTimeout(resolve, 1500));
    if (process.env.THQ_SMOKE_VIEW) {
      host.openView(process.env.THQ_SMOKE_VIEW);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    // THQ_SMOKE_CLICK: comma-separated selectors to click in the dashboard first, e.g. to open a section.
    for (const selector of (process.env.THQ_SMOKE_CLICK ?? '').split(',').filter(Boolean)) {
      await host.windows().find(([name]) => name === 'dashboard')?.[1].webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
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
    // THQ_SMOKE_JS: run a snippet in the dashboard before the screenshots (e.g. type into the composer).
    if (process.env.THQ_SMOKE_JS) {
      const result: unknown = await host.windows().find(([name]) => name === 'dashboard')?.[1].webContents.executeJavaScript(process.env.THQ_SMOKE_JS);
      if (result !== undefined) process.stdout.write(`js ${JSON.stringify(result)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
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
