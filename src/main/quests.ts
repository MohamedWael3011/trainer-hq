import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { EventKind, QuestKind, QuestStatus, type QuestKindType, type QuestStatusType } from '@shared/constants';
import type { QuestEventType, QuestType, QuestUsageType, StatsType } from '@shared/types';
import { profileHome } from './paths';

const QUESTS_FILE = 'quests.json';
const SESSIONS_FILE = 'sessions.json';
const STATS_FILE = 'stats.json';
const HELD_FILE = 'held.json';
const KEEP_QUESTS = 200;
const KEEP_EVENTS = 400;
const TITLE_LIMIT = 90;
const DAYS = 14;
const MS_PER_DAY = 86_400_000;
const RECAP_EXCHANGES = 3;
const RECAP_ASK_CHARS = 500;
const RECAP_ANSWER_CHARS = 1_500;
const RECAP_STEPS = 12;
const RECAP_STEP_CHARS = 160;
const RECAP_OUTPUTS = 8;
const LIVE = new Set<QuestStatusType>([QuestStatus.RUNNING, QuestStatus.WAITING]);
const INTERRUPTED = new Set<QuestStatusType>([QuestStatus.FAILED, QuestStatus.PAUSED, QuestStatus.CANCELLED]);

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
};

export class QuestStore {
  private quests: QuestType[] = [];
  private sessions: Record<string, string> = {};
  private notesLearned = 0;
  private dir = '';
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(private readonly onChange: () => void) {}

  load(profileId: string): void {
    this.dir = profileHome(profileId);
    mkdirSync(this.dir, { recursive: true });
    this.quests = readJson<QuestType[]>(join(this.dir, QUESTS_FILE), []).map((quest) =>
      LIVE.has(quest.status) ? { ...quest, status: QuestStatus.CANCELLED, endedAt: quest.endedAt ?? Date.now() } : quest,
    );
    this.sessions = readJson<Record<string, string>>(join(this.dir, SESSIONS_FILE), {});
    this.notesLearned = readJson<{ notesLearned: number }>(join(this.dir, STATS_FILE), { notesLearned: 0 }).notesLearned;
  }

  // Messages waiting for a plan limit to reset. Saved straight away so a restart doesn't lose them.
  loadHeld<T>(): Record<string, T> {
    return readJson<Record<string, T>>(join(this.dir, HELD_FILE), {});
  }

  saveHeld(held: Record<string, unknown>): void {
    if (this.dir) writeFileSync(join(this.dir, HELD_FILE), JSON.stringify(held));
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      writeFileSync(join(this.dir, QUESTS_FILE), JSON.stringify(this.quests.slice(0, KEEP_QUESTS)));
      writeFileSync(join(this.dir, SESSIONS_FILE), JSON.stringify(this.sessions));
      writeFileSync(join(this.dir, STATS_FILE), JSON.stringify({ notesLearned: this.notesLearned }));
    }, 300);
  }

  create(creatureId: string, kind: QuestKindType, prompt: string, cwd?: string, parentId?: string, askedBy?: string, threadId?: string): QuestType {
    const quest: QuestType = {
      id: randomUUID(),
      creatureId,
      kind,
      title: prompt.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT),
      status: QuestStatus.RUNNING,
      startedAt: Date.now(),
      events: [],
      cwd,
      parentId,
      askedBy,
      threadId,
    };
    this.quests.unshift(quest);
    this.persist();
    this.onChange();
    return quest;
  }

  get(id: string): QuestType | undefined {
    return this.quests.find((quest) => quest.id === id);
  }

  addEvent(id: string, event: Omit<QuestEventType, 'at'>): void {
    const quest = this.get(id);
    if (!quest) return;
    quest.events.push({ ...event, at: Date.now() });
    if (quest.events.length > KEEP_EVENTS) quest.events.splice(0, quest.events.length - KEEP_EVENTS);
    this.persist();
    this.onChange();
  }

  setStatus(id: string, status: QuestStatusType): void {
    const quest = this.get(id);
    if (!quest || quest.status === status) return;
    quest.status = status;
    if (!LIVE.has(status)) quest.endedAt = Date.now();
    this.persist();
    this.onChange();
  }

  setSession(id: string, sessionId: string): void {
    const quest = this.get(id);
    if (!quest) return;
    quest.sessionId = sessionId;
    this.sessions[quest.threadId ? `${quest.creatureId}:${quest.threadId}` : quest.creatureId] = sessionId;
    this.persist();
  }

  markFreshSession(id: string): void {
    const quest = this.get(id);
    if (!quest) return;
    quest.freshSession = true;
    this.persist();
  }

  setUsage(id: string, usage: QuestUsageType): void {
    const quest = this.get(id);
    if (!quest) return;
    quest.usage = usage;
    this.persist();
    this.onChange();
  }

  // When the session was last used and how big it was, so a cold resume of a huge session can be avoided.
  sessionActivity(sessionId: string): { at: number; contextTokens?: number; model?: string } | undefined {
    const last = this.quests.find((quest) => quest.sessionId === sessionId);
    if (!last) return undefined;
    const withContext = this.quests.find((quest) => quest.sessionId === sessionId && quest.usage?.contextTokens);
    const withModel = this.quests.find((quest) => quest.sessionId === sessionId && quest.usage?.model);
    return { at: last.endedAt ?? last.startedAt, contextTokens: withContext?.usage?.contextTokens, model: withModel?.usage?.model };
  }

  sessionInterrupted(sessionId: string): boolean {
    const last = this.quests.find((quest) => quest.sessionId === sessionId);
    return !!last && INTERRUPTED.has(last.status);
  }

  sessionFloor(creatureId: string): number | undefined {
    return this.quests.find((quest) => quest.creatureId === creatureId && quest.freshSession && quest.usage?.baseTokens)?.usage?.baseTokens;
  }

  // Rough conversation size for engines that don't report it: what was sent and received so far.
  sessionTokenEstimate(sessionId: string): number {
    return this.quests
      .filter((quest) => quest.sessionId === sessionId)
      .reduce((sum, quest) => sum + (quest.usage ? quest.usage.inputTokens + quest.usage.outputTokens : 0), 0);
  }

  // A short text recap of the last few exchanges in a session, to carry over into a fresh one.
  recap(sessionId: string, count = RECAP_EXCHANGES): string {
    const clip = (text: string, limit: number): string => {
      const flat = text.replace(/\s+/g, ' ').trim();
      return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
    };
    return this.quests
      .filter((quest) => quest.sessionId === sessionId && quest.kind === QuestKind.CHAT)
      .slice(0, count)
      .reverse()
      .map((quest) => {
        const asked = quest.events.find((event) => event.kind === EventKind.USER)?.text ?? quest.title;
        const answer = [...quest.events].reverse().find((event) => event.kind === EventKind.RESULT || event.kind === EventKind.TEXT)?.text ?? '(no answer recorded)';
        if (!INTERRUPTED.has(quest.status)) return `User: ${clip(asked, RECAP_ASK_CHARS)}\nYou: ${clip(answer, RECAP_ANSWER_CHARS)}`;
        const steps = quest.events.filter((event) => event.kind === EventKind.TOOL).slice(-RECAP_STEPS).map((event) => `- ${clip(event.text, RECAP_STEP_CHARS)}`);
        const outputs = quest.events.filter((event) => event.kind === EventKind.OUTPUT).slice(-RECAP_OUTPUTS).map((event) => `- ${event.text}`);
        const stopped = [...quest.events].reverse().find((event) => event.kind === EventKind.ERROR)?.text;
        return [
          `User: ${clip(asked, RECAP_ASK_CHARS)}`,
          `You were interrupted before finishing${stopped ? ` (${clip(stopped, RECAP_STEP_CHARS)})` : ''}. The last thing you said: ${clip(answer, RECAP_ANSWER_CHARS)}`,
          steps.length > 0 ? `Your last steps, oldest first (files you wrote are still on disk; reuse them instead of redoing the work):\n${steps.join('\n')}` : '',
          outputs.length > 0 ? `Files you produced:\n${outputs.join('\n')}` : '',
        ].filter(Boolean).join('\n');
      })
      .join('\n\n');
  }

  sessionFor(key: string): string | undefined {
    return this.sessions[key];
  }

  clearSession(key: string): void {
    delete this.sessions[key];
    this.persist();
  }

  moveChat(creatureId: string, fromThreadId: string | undefined, toThreadId: string): string[] {
    const moved = this.quests.filter(
      (quest) => quest.creatureId === creatureId && (quest.kind === QuestKind.CHAT || quest.kind === QuestKind.HANDOFF) && quest.threadId === fromThreadId,
    );
    moved.forEach((quest) => {
      quest.threadId = toThreadId;
    });
    const fromKey = fromThreadId ? `${creatureId}:${fromThreadId}` : creatureId;
    const session = this.sessions[fromKey];
    delete this.sessions[fromKey];
    if (session) this.sessions[`${creatureId}:${toThreadId}`] = session;
    this.persist();
    this.onChange();
    return moved.map((quest) => quest.id);
  }

  clearThread(creatureId: string, threadId?: string): string[] {
    delete this.sessions[threadId ? `${creatureId}:${threadId}` : creatureId];
    const targetIds = new Set(
      this.quests
        .filter((quest) => quest.creatureId === creatureId && (quest.kind === QuestKind.CHAT || quest.kind === QuestKind.HANDOFF) && quest.threadId === threadId)
        .map((quest) => quest.id),
    );
    this.quests.forEach((quest) => {
      if (quest.parentId && targetIds.has(quest.parentId)) targetIds.add(quest.id);
    });
    if (targetIds.size > 0) {
      this.quests = this.quests.filter((quest) => !targetIds.has(quest.id));
    }
    this.persist();
    this.onChange();
    return Array.from(targetIds);
  }

  countLearned(count: number): void {
    this.notesLearned += count;
    this.persist();
    this.onChange();
  }

  list(): QuestType[] {
    return this.quests;
  }

  stats(): StatsType {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - (DAYS - 1) * MS_PER_DAY;
    const sessionsByDay = Array.from({ length: DAYS }, () => 0);
    this.quests.forEach((quest) => {
      const index = Math.floor((quest.startedAt - start) / MS_PER_DAY);
      if (index >= 0 && index < DAYS) sessionsByDay[index] += 1;
    });
    return {
      questsDone: this.quests.filter((quest) => quest.status === QuestStatus.DONE).length,
      notesLearned: this.notesLearned,
      sessionsByDay,
    };
  }
}
