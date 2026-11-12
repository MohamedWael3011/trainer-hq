import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  Autonomy,
  MAX_HANDOFF_DEPTH,
  DaycareAction,
  DaycareMode,
  EngineAdapter,
  EventKind,
  QuestKind,
  QuestStatus,
  type AutonomyType,
  type QuestKindType,
} from '@shared/constants';
import type {
  UpdateInfoType,
  QuestLiveType,
  AppStateType,
  AuthStatusType,
  ApprovalDecisionType,
  ChatRequestType,
  CreatureType,
  DaycareDecisionType,
  HatchRequestType,
  DockSizeType,
  ProfileCreateRequestType,
  ProfileSettingsType,
  PrerequisiteType,
  ProfileSummaryType,
  QuestUsageType,
  SkillInstallRequestType,
  ThreadCreateRequestType,
  ThreadType,
  UsageType,
} from '@shared/types';
import { ApprovalBroker, type AskRequestType } from './approvals';
import { attachmentDirs, detectPaths, installSkill, prepareAttachments } from './attachments';
import { checkAuth, openLoginTerminal, openSessionTerminal, runInTerminal } from './auth';
import { checkForUpdate } from './updates';
import { limitResetAt } from './limits';
import { claudeFlagSupport, resetFlagSupport } from './engines/claudeFlags';
import { buildSystemPrompt } from './brain';
import { addProfile, loadProfileConfig, loadProfiles, setActiveProfile, type ProfileConfigType } from './config';
import { approveNote, buildProposalPrompt, dismissNote, inlineProposals, listDaycare, parseProposals, worthReviewing, writeProposals, type ProposalType } from './daycare';
import { runClaude } from './engines/claude';
import { runCli } from './engines/cli';
import type { RunHandleType } from './engines/types';
import { planClaudeRun, sessionContextFromLog } from './guard';
import { buildHatchPrompt, hatcheryCreature } from './hatchery';
import { resourcesDir } from './paths';
import { QuestStore } from './quests';
import { ThreadStore, threadKey } from './threads';
import { Lab } from './lab';
import { readSettings, writeSettings } from './settings';
import { checkPrerequisites } from './prereqs';
import { loadCreatures, updateCreatureFile, watchVault } from './registry';
import { clearOverride, resolveSprite, setOverride } from './sprites';
import { loadUi, saveUi } from './ui';
import { listAntigravityModels, planAntigravityArgs, runAntigravity } from './engines/antigravity';

const AGY_SESSION_PREFIX = 'agy:';

type HeldEntryType = {
  creatureId: string;
  threadId?: string;
  resumeAt: number;
  questId: string;
  requests: ChatRequestType[];
};

const clockLabel = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const DAYCARE_MODEL = 'haiku';

const STATE_THROTTLE_MS = 60;
// Live typing and token counts update many times a second; ~10 frames a second reads as smooth.
const LIVE_THROTTLE_MS = 100;
const HANDOFF_TIMEOUT_MS = 10 * 60_000;
const AUTH_REFRESH_MS = 10 * 60_000;
// GitHub allows 60 anonymous API calls an hour; a check every few hours is plenty.
const UPDATE_CHECK_MS = 3 * 60 * 60_000;
const UPDATE_FIRST_CHECK_MS = 20_000;
// Wait a little past the stated reset so the first retry doesn't land a moment too early.
const RESET_GRACE_MS = 60_000;
const AUTH_ERROR_PATTERN = /\/login|not logged in|unauthori[sz]ed|invalid api key|authentication|401/i;

export class Hq {
  private profileId = '';
  private profile!: ProfileConfigType;
  private profiles: ProfileSummaryType[] = [];
  private creatures: CreatureType[] = [];
  private errors: string[] = [];
  private spriteRev: Record<string, number> = {};
  private usage: UsageType | undefined;
  private ui = loadUi();
  private auth: AuthStatusType | undefined;
  private authTimer: NodeJS.Timeout | undefined;
  private updateTimer: NodeJS.Timeout | undefined;
  private update: UpdateInfoType | undefined;
  private running = new Map<string, RunHandleType>();
  // The chat quest currently running per session, and messages waiting for it to finish.
  private liveChats = new Map<string, string>();
  private live: Record<string, QuestLiveType> = {};
  private liveListeners = new Set<(live: Record<string, QuestLiveType>) => void>();
  private liveTimer: NodeJS.Timeout | undefined;
  private chatQueue = new Map<string, ChatRequestType[]>();
  // Messages that hit the plan usage limit, per session, sent again once the limit resets.
  private held = new Map<string, HeldEntryType>();
  private heldTimer: NodeJS.Timeout | undefined;
  private stopWatching: (() => void) | undefined;
  private emitTimer: NodeJS.Timeout | undefined;
  private listeners = new Set<(state: AppStateType) => void>();
  private readonly quests = new QuestStore(() => this.emit());
  private readonly threads = new ThreadStore();
  readonly lab = new Lab(
    () => ({ config: this.profile.lab, env: this.profile.env }),
    () => this.emitLab(),
  );
  private labListeners = new Set<() => void>();

  onLab(listener: () => void): () => void {
    this.labListeners.add(listener);
    return () => this.labListeners.delete(listener);
  }

  private emitLab(): void {
    this.labListeners.forEach((listener) => listener());
  }
  private readonly approvals = new ApprovalBroker(
    (questId) => this.quests.get(questId)?.creatureId,
    () => this.onApprovalsChanged(),
    (request) => this.ask(request),
  );
  private depth = new Map<string, number>();

  async start(): Promise<void> {
    await this.approvals.start();
    this.loadProfile();
  }

  private loadProfile(): void {
    const file = loadProfiles();
    this.profileId = file.active;
    this.profiles = Object.entries(file.profiles).map(([id, entry]) => {
      const config = loadProfileConfig(entry.vault);
      return { id, name: config.name, vault: config.vault };
    });
    this.profile = loadProfileConfig(file.profiles[file.active].vault);
    this.quests.load(this.profileId);
    this.threads.load(this.profileId);
    this.auth = undefined;
    this.reloadVault();
    void this.refreshAuth();
    if (this.authTimer) clearInterval(this.authTimer);
    this.authTimer = setInterval(() => void this.refreshAuth(), AUTH_REFRESH_MS);
    this.stopWatching?.();
    this.stopWatching = watchVault(this.profile.vault, () => {
      this.profile = loadProfileConfig(this.profile.vault);
      this.reloadVault();
    });
  }

  private reloadVault(): void {
    const { creatures, errors } = loadCreatures(this.profile.vault);
    this.creatures = creatures;
    this.errors = errors;
    creatures.forEach((creature) => { this.spriteRev[creature.id] = (this.spriteRev[creature.id] ?? 0) + 1; });
    this.emit();
  }

  private onApprovalsChanged(): void {
    this.quests.list()
      .filter((quest) => quest.status === QuestStatus.RUNNING || quest.status === QuestStatus.WAITING)
      .forEach((quest) => {
        this.quests.setStatus(quest.id, this.approvals.hasPendingForQuest(quest.id) ? QuestStatus.WAITING : QuestStatus.RUNNING);
      });
    this.emit();
  }

  getLive(): Record<string, QuestLiveType> {
    return this.live;
  }

  onLive(listener: (live: Record<string, QuestLiveType>) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  private setLive(questId: string, value: QuestLiveType | undefined): void {
    if (value) this.live = { ...this.live, [questId]: value };
    else if (this.live[questId]) {
      const { [questId]: _removed, ...rest } = this.live;
      this.live = rest;
    } else return;
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = undefined;
      this.liveListeners.forEach((listener) => listener(this.live));
    }, LIVE_THROTTLE_MS);
  }

  onState(listener: (state: AppStateType) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      const state = this.getState();
      this.listeners.forEach((listener) => listener(state));
    }, STATE_THROTTLE_MS);
  }

  getState(): AppStateType {
    return {
      profile: { id: this.profileId, name: this.profile.name, vault: this.profile.vault },
      profiles: this.profiles,
      creatures: this.creatures,
      quests: this.quests.list(),
      threads: this.threads.list(),
      approvals: this.approvals.list(),
      daycare: listDaycare(this.profile.vault),
      repos: Object.keys(this.profile.repos),
      engines: Object.keys(this.profile.engines),
      engineAdapters: Object.fromEntries(Object.entries(this.profile.engines).map(([name, engine]) => [name, engine.adapter])),
      spriteRev: this.spriteRev,
      stats: this.quests.stats(),
      usage: this.usage,
      ui: this.ui,
      labEnabled: !!this.profile.lab,
      auth: this.auth,
      update: this.update,
      held: Array.from(this.held.values()).map((entry) => ({
        creatureId: entry.creatureId,
        threadId: entry.threadId,
        questId: entry.questId,
        resumeAt: entry.resumeAt,
        count: entry.requests.length,
      })),
      errors: this.errors,
    };
  }

  spritePath(id: string): string {
    return resolveSprite(id, this.creatures, this.profile.spriteOverrides);
  }

  private creature(id: string): CreatureType {
    const creature = this.creatures.find((entry) => entry.id === id);
    if (!creature) throw new Error(`No creature with id "${id}" in this profile.`);
    return creature;
  }

  private env(): NodeJS.ProcessEnv {
    const env = { ...process.env, ...this.profile.env };
    delete env.ELECTRON_RUN_AS_NODE;
    if (this.profile.claudeConfigDir) env.CLAUDE_CONFIG_DIR = this.profile.claudeConfigDir;
    return env;
  }

  private launch(creature: CreatureType, kind: QuestKindType, prompt: string, options: { resume: boolean; record: boolean; parentId?: string; askedBy?: string; recordText?: string; thread?: ThreadType; request?: ChatRequestType }): string {
    const thread = options.thread;
    if (thread?.cwd) creature = { ...creature, cwd: thread.cwd };
    const sessionKey = threadKey(creature.id, thread?.id);
    if (thread) this.threads.touch(thread.id);
    const engine = this.profile.engines[creature.engine] ?? this.profile.engines.claude;
    // A missing cwd makes spawn fail with a misleading "spawn claude ENOENT", so fall back to the vault.
    const cwd = creature.cwd && existsSync(creature.cwd) ? creature.cwd : this.profile.vault;
    const quest = this.quests.create(creature.id, kind, options.recordText ?? prompt, cwd, options.parentId, options.askedBy, thread?.id);
    if (options.record) this.quests.addEvent(quest.id, { kind: EventKind.USER, text: options.recordText ?? prompt });
    const planUsage = this.usage?.fiveHour ?? 0;
    // The plan-usage guard is about the Claude plan; other engines have their own quotas.
    if (engine.adapter === EngineAdapter.CLAUDE && creature.autonomy === Autonomy.FULL_AUTO && planUsage >= this.profile.guard.fullAutoMaxPlanUsage) {
      this.quests.addEvent(quest.id, {
        kind: EventKind.ERROR,
        text: `Not started: your 5-hour plan usage is at ${Math.round(planUsage * 100)}%, above the full-auto limit of ${Math.round(this.profile.guard.fullAutoMaxPlanUsage * 100)}%. Switch this creature to auto-edit or wait for the reset.`,
      });
      this.quests.setStatus(quest.id, QuestStatus.PAUSED);
      return quest.id;
    }
    const threadContext = thread
      ? `You are in the thread "${thread.title}". Work in ${thread.cwd ?? cwd}${thread.branch ? ` on branch ${thread.branch}` : ''}${thread.pr ? ` (PR ${thread.pr})` : ''}${thread.worktree ? '. This is an isolated git worktree just for this thread.' : '.'} Keep this thread focused on that work.`
      : '';
    // Claude and Antigravity session ids live in the same slot, so tag Antigravity's to keep them apart.
    let stored = options.resume ? this.quests.sessionFor(sessionKey) : undefined;
    let recapContext = '';
    const isCompact = /^\/compact\b/.test(prompt.trim());
    if (stored && !isCompact && engine.adapter === EngineAdapter.CLAUDE && !stored.startsWith(AGY_SESSION_PREFIX) && this.isColdAndLarge(stored)) {
      const recap = this.quests.recap(stored);
      this.quests.clearSession(sessionKey);
      stored = undefined;
      recapContext = recap
        ? `This chat continues an earlier conversation that was closed to save tokens (it was large and idle). The last exchanges were:\n\n${recap}\n\nIf you need more than this, check your brain notes, git log or the files, or ask the user. Don't re-explore everything.`
        : '';
      this.quests.addEvent(quest.id, { kind: EventKind.SYSTEM, text: 'Started a fresh session: the previous one was large and idle, so resuming it would have re-billed the whole conversation. A short recap was carried over.' });
    }
    const systemPrompt = buildSystemPrompt(creature, this.profile, this.creatures, [threadContext, recapContext].filter(Boolean).join('\n\n'));
    const agySession = stored?.startsWith(AGY_SESSION_PREFIX) ? stored.slice(AGY_SESSION_PREFIX.length) : undefined;
    const claudeSession = stored && !stored.startsWith(AGY_SESSION_PREFIX) ? stored : undefined;
    const callbacks = {
      onEvent: (event: { kind: (typeof EventKind)[keyof typeof EventKind]; text: string }) => this.quests.addEvent(quest.id, event),
      onSession: (sessionId: string) => this.quests.setSession(quest.id, engine.adapter === EngineAdapter.ANTIGRAVITY ? `${AGY_SESSION_PREFIX}${sessionId}` : sessionId),
      onQuestUsage: (questUsage: QuestUsageType) => this.quests.setUsage(quest.id, questUsage),
      onLive: (live: QuestLiveType) => this.setLive(quest.id, live),
      onUsage: (usage: UsageType) => {
        this.usage = usage;
        this.emit();
      },
    };
    let handle: RunHandleType;
    if (engine.adapter === EngineAdapter.CLAUDE) {
      const plan = planClaudeRun({
        creature,
        profile: this.profile,
        systemPrompt,
        questId: quest.id,
        resumeSessionId: claudeSession,
        skipWorktree: !!thread?.worktree,
        supports: claudeFlagSupport(engine.bin, this.env()),
        sessionName: `${creature.name} · ${thread?.title ?? 'Main'}`,
        bridge: {
          serverScript: join(resourcesDir(), 'mcp', 'permission-server.cjs'),
          nodeBinary: process.execPath,
          port: this.approvals.port,
          token: this.approvals.token,
          questId: quest.id,
        },
      });
      if (!claudeSession && !isCompact) this.quests.markFreshSession(quest.id);
      handle = runClaude({ bin: engine.bin, args: [...engine.args, ...plan.args], prompt, cwd, env: this.env(), timeoutMs: plan.timeoutMs, callbacks });
    } else if (engine.adapter === EngineAdapter.ANTIGRAVITY) {
      const timeoutMs = creature.autonomy === Autonomy.FULL_AUTO ? this.profile.guard.fullAutoMaxMinutes * 60_000 : undefined;
      const args = planAntigravityArgs({ autonomy: creature.autonomy, model: creature.model, addDirs: [creature.dir, ...creature.addDirs], conversationId: agySession });
      // A resumed conversation already holds the creature's instructions; don't pay for them again.
      const fullPrompt = agySession ? prompt : `${systemPrompt}\n\n---\n\n${prompt}`;
      handle = runAntigravity({ bin: engine.bin, args: [...engine.args, ...args], prompt: fullPrompt, cwd, env: this.env(), timeoutMs, callbacks });
    } else {
      const timeoutMs = creature.autonomy === Autonomy.FULL_AUTO ? this.profile.guard.fullAutoMaxMinutes * 60_000 : undefined;
      handle = runCli({ bin: engine.bin, args: engine.args, prompt, systemPrompt, cwd, env: this.env(), timeoutMs, callbacks });
    }
    this.running.set(quest.id, handle);
    if (kind === QuestKind.CHAT) this.liveChats.set(sessionKey, quest.id);
    void handle.done.then((outcome) => {
      this.running.delete(quest.id);
      this.setLive(quest.id, undefined);
      if (this.liveChats.get(sessionKey) === quest.id) {
        this.liveChats.delete(sessionKey);
        // Send what was queued behind this run, in order, as one message. A stopped run drops the queue.
        const queued = this.chatQueue.get(sessionKey) ?? [];
        this.chatQueue.delete(sessionKey);
        if (queued.length > 0 && !outcome.cancelled) {
          setTimeout(() => {
            try {
              this.chat({
                ...queued[0],
                text: queued.map((entry) => entry.text).join('\n\n'),
                attachments: queued.flatMap((entry) => entry.attachments ?? []),
              });
            } catch {
              // The creature or thread is gone; nothing to send to.
            }
          }, 0);
        }
      }
      this.approvals.denyAllForQuest(quest.id);
      if (outcome.usage) this.quests.setUsage(quest.id, outcome.usage);
      if (outcome.ok) {
        if (outcome.resultText && engine.adapter === EngineAdapter.CLAUDE) this.quests.addEvent(quest.id, { kind: EventKind.RESULT, text: outcome.resultText });
        this.quests.setStatus(quest.id, QuestStatus.DONE);
        if (kind === QuestKind.CHAT) this.proposeNotes(creature, quest.id);
        return;
      }
      if (outcome.cancelled) {
        this.quests.setStatus(quest.id, QuestStatus.CANCELLED);
        return;
      }
      if (outcome.usageLimited) {
        // The rate-limit report is about the Claude plan; other engines only say it in their error.
        const resumeAt = options.request ? limitResetAt(engine.adapter === EngineAdapter.CLAUDE ? this.usage : undefined, outcome.error) : undefined;
        if (options.request && resumeAt) {
          this.hold(sessionKey, options.request, resumeAt, quest.id);
          this.quests.addEvent(quest.id, { kind: EventKind.ERROR, text: `Paused: your plan usage limit was reached. This message sends again automatically at ${clockLabel(resumeAt)}.` });
        } else {
          this.quests.addEvent(quest.id, { kind: EventKind.ERROR, text: 'Paused: your plan usage limit was reached. Retry after it resets.' });
        }
        this.quests.setStatus(quest.id, QuestStatus.PAUSED);
        return;
      }
      const message = outcome.timedOut
        ? `Stopped after ${this.profile.guard.fullAutoMaxMinutes} minutes (full-auto time limit).`
        : outcome.error ?? 'The engine stopped with an unknown error.';
      if (/No conversation found|session|conversation/i.test(message) && options.resume) this.quests.clearSession(sessionKey);
      if (AUTH_ERROR_PATTERN.test(message)) void this.refreshAuth();
      this.quests.addEvent(quest.id, { kind: EventKind.ERROR, text: message });
      this.quests.setStatus(quest.id, QuestStatus.FAILED);
    });
    return quest.id;
  }

  // Past the idle limit the prompt cache has expired, so resuming re-bills the whole conversation
  // as a cache write. For a big session a fresh start with a recap is far cheaper.
  private isColdAndLarge(sessionId: string): boolean {
    const { idleResetMinutes, idleResetMinTokens } = this.profile.session;
    if (idleResetMinutes <= 0) return false;
    const activity = this.quests.sessionActivity(sessionId);
    if (!activity || Date.now() - activity.at < idleResetMinutes * 60_000) return false;
    const size = activity.contextTokens ?? sessionContextFromLog(sessionId, this.profile.claudeConfigDir);
    return (size ?? 0) >= idleResetMinTokens;
  }

  // `recorded`: the message is already in the chat log (a held message being sent again).
  chat(request: ChatRequestType, recorded = false): string {
    const creature = this.creature(request.creatureId);
    const thread = this.threads.get(request.threadId);
    const sessionKey = threadKey(creature.id, thread?.id);
    const waiting = this.held.get(sessionKey);
    if (waiting) {
      // Sending now would only fail again; add it to what goes out after the reset.
      waiting.requests.push(request);
      this.quests.addEvent(waiting.questId, { kind: EventKind.USER, text: request.text });
      this.quests.addEvent(waiting.questId, { kind: EventKind.SYSTEM, text: `Held until the limit resets at ${clockLabel(waiting.resumeAt)}.` });
      return waiting.questId;
    }
    const liveId = this.liveChats.get(sessionKey);
    if (liveId) {
      const hasFiles = (request.attachments ?? []).length > 0 || detectPaths(request.text).length > 0;
      const isCommand = request.text.trim().startsWith('/');
      // Like the terminal: a message sent while Claude works is picked up mid-task by the same run.
      // Files need new folder access and commands need a turn of their own, so those wait instead.
      if (!hasFiles && !isCommand && this.running.get(liveId)?.send?.(request.text)) {
        this.quests.addEvent(liveId, { kind: EventKind.USER, text: request.text });
        return liveId;
      }
      this.chatQueue.set(sessionKey, [...(this.chatQueue.get(sessionKey) ?? []), request]);
      this.quests.addEvent(liveId, { kind: EventKind.SYSTEM, text: `Queued, sends when this reply finishes: ${request.text.replace(/\s+/g, ' ').slice(0, 120)}` });
      return liveId;
    }
    const paths = Array.from(new Set([...(request.attachments ?? []), ...detectPaths(request.text)]));
    const prepared = prepareAttachments(paths);
    if (prepared.length === 0) return this.launch(creature, QuestKind.CHAT, request.text, { resume: true, record: !recorded, thread, request });
    const moved = prepared.filter((entry) => entry.source !== entry.target);
    const notes = moved.map((entry) => `- ${entry.source} is available at ${entry.target}${entry.source.endsWith('.zip') ? ' (unzipped)' : ''}`);
    const prompt = notes.length > 0 ? `${request.text}\n\n${notes.join('\n')}` : request.text;
    const withAccess = { ...creature, addDirs: [...creature.addDirs, ...attachmentDirs(prepared.map((entry) => entry.target))] };
    return this.launch(withAccess, QuestKind.CHAT, prompt, { resume: true, record: !recorded, thread, request });
  }

  private hold(sessionKey: string, request: ChatRequestType, resumeAt: number, questId: string): void {
    const existing = this.held.get(sessionKey);
    this.held.set(sessionKey, {
      creatureId: request.creatureId,
      threadId: request.threadId,
      resumeAt,
      questId,
      requests: [...(existing?.requests ?? []), request],
    });
    this.scheduleHeld();
    this.emit();
  }

  private scheduleHeld(): void {
    if (this.heldTimer) clearTimeout(this.heldTimer);
    this.heldTimer = undefined;
    if (this.held.size === 0) return;
    const next = Math.min(...Array.from(this.held.values()).map((entry) => entry.resumeAt));
    this.heldTimer = setTimeout(() => {
      this.heldTimer = undefined;
      const now = Date.now();
      Array.from(this.held.entries())
        .filter(([, entry]) => entry.resumeAt + RESET_GRACE_MS <= now)
        .forEach(([key]) => this.releaseHeld(key));
      this.scheduleHeld();
    }, Math.max(0, next + RESET_GRACE_MS - Date.now()));
  }

  // Sends a session's held messages as one, the way queued messages go out.
  private releaseHeld(sessionKey: string): void {
    const entry = this.held.get(sessionKey);
    if (!entry) return;
    this.held.delete(sessionKey);
    this.emit();
    try {
      const questId = this.chat({
        creatureId: entry.creatureId,
        threadId: entry.threadId,
        text: entry.requests.map((request) => request.text).join('\n\n'),
        attachments: entry.requests.flatMap((request) => request.attachments ?? []),
      }, true);
      this.quests.addEvent(questId, { kind: EventKind.SYSTEM, text: 'Sending your held message now.' });
    } catch {
      // The creature or thread is gone; nothing to send to.
    }
  }

  sendHeldNow(creatureId: string, threadId?: string): void {
    this.releaseHeld(threadKey(creatureId, threadId));
    this.scheduleHeld();
  }

  cancelHeld(creatureId: string, threadId?: string): void {
    const sessionKey = threadKey(creatureId, threadId);
    const entry = this.held.get(sessionKey);
    if (!entry) return;
    this.held.delete(sessionKey);
    this.quests.addEvent(entry.questId, { kind: EventKind.SYSTEM, text: 'Held message cancelled.' });
    this.scheduleHeld();
    this.emit();
  }

  private async ask(request: AskRequestType): Promise<string> {
    const parent = this.quests.get(request.questId);
    if (!parent) throw new Error('The asking quest is no longer running.');
    const key = request.creature.trim().toLowerCase();
    const target = this.creatures.find((entry) => entry.id.toLowerCase() === key || entry.name.toLowerCase() === key);
    if (!target) throw new Error(`No creature "${request.creature}". Teammates: ${this.creatures.map((entry) => entry.id).join(', ')}.`);
    if (target.id === parent.creatureId) throw new Error('A creature cannot ask itself.');
    const parentDepth = this.depth.get(parent.id) ?? 0;
    if (parentDepth >= MAX_HANDOFF_DEPTH) throw new Error(`Handoff chain limit (${MAX_HANDOFF_DEPTH}) reached. Answer with what you have.`);
    const asker = this.creatures.find((entry) => entry.id === parent.creatureId);
    const askerLabel = asker ? `${asker.name} (${asker.role})` : parent.creatureId;
    const prompt = `${askerLabel} is asking you this as part of their task. Answer it fully and concisely; they only see your final answer.\n\n${request.question}`;
    const childId = this.launch(target, QuestKind.HANDOFF, prompt, {
      resume: false,
      record: true,
      parentId: parent.id,
      askedBy: parent.creatureId,
      recordText: request.question,
    });
    this.depth.set(childId, parentDepth + 1);
    const handle = this.running.get(childId);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, HANDOFF_TIMEOUT_MS));
    if (handle) await Promise.race([handle.done.then(() => undefined), timeout]);
    const child = this.quests.get(childId);
    if (child && (child.status === QuestStatus.RUNNING || child.status === QuestStatus.WAITING)) {
      handle?.cancel();
      return `${target.name} did not answer within ${HANDOFF_TIMEOUT_MS / 60_000} minutes.`;
    }
    const answer = [...(child?.events ?? [])].reverse().find((event) => event.kind === EventKind.RESULT || event.kind === EventKind.TEXT);
    const failure = [...(child?.events ?? [])].reverse().find((event) => event.kind === EventKind.ERROR);
    if (child?.status !== QuestStatus.DONE) return `${target.name} could not answer: ${failure?.text ?? child?.status ?? 'unknown error'}`;
    return answer?.text ?? `${target.name} finished without an answer.`;
  }

  installSkill(request: SkillInstallRequestType): string {
    if (!request.creatureId) {
      const skillsDir = join(this.profile.claudeConfigDir ?? join(homedir(), '.claude'), 'skills');
      return installSkill(request.path, skillsDir);
    }
    const creature = this.creature(request.creatureId);
    const name = installSkill(request.path, join(creature.dir, 'skills'));
    if (!creature.skills.includes(name)) updateCreatureFile(creature, { skills: [...creature.skills, name] });
    this.reloadVault();
    return name;
  }

  hatch(request: HatchRequestType): string {
    const creature = hatcheryCreature(this.profile, request.repos);
    const nextNo = this.creatures.reduce((max, entry) => Math.max(max, entry.no), 0) + 1;
    return this.launch(creature, QuestKind.HATCH, buildHatchPrompt(request, this.profile, nextNo), { resume: false, record: false });
  }

  private proposeNotes(creature: CreatureType, questId: string): void {
    const mode = this.profile.daycareMode;
    if (mode === DaycareMode.OFF) return;
    const quest = this.quests.get(questId);
    if (!quest || quest.events.length < 2) return;
    const save = (items: ProposalType[]): void => {
      const ids = writeProposals(this.profile.vault, creature, quest, items);
      if (ids.length === 0) return;
      const autoApprove = this.profile.daycareAutoApproveFullAuto && creature.autonomy === Autonomy.FULL_AUTO && !creature.learnsReview;
      if (autoApprove) ids.forEach((id) => this.decideDaycare({ id, action: DaycareAction.APPROVE }));
      this.emit();
    };
    if (mode === DaycareMode.FREE) {
      save(inlineProposals(this.profile.vault, creature, quest));
      return;
    }
    if (!worthReviewing(quest)) return;
    const engine = this.profile.engines.claude;
    const handle = runClaude({
      bin: engine.bin,
      // Runs after every chat that did real work, so keep it on the cheapest model.
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--model', DAYCARE_MODEL],
      prompt: buildProposalPrompt(creature, quest),
      cwd: this.profile.vault,
      env: this.env(),
      callbacks: { onEvent: () => undefined },
    });
    void handle.done.then((outcome) => {
      if (outcome.ok) save(parseProposals(outcome.resultText));
    });
  }

  cancel(questId: string): void {
    this.running.get(questId)?.cancel();
  }

  decideApproval(decision: ApprovalDecisionType): void {
    this.approvals.decide(decision.id, decision.decision);
  }

  createThread(request: ThreadCreateRequestType): string {
    this.creature(request.creatureId);
    const repoPath = request.repo ? this.profile.repos[request.repo] : undefined;
    if (request.repo && !repoPath) throw new Error(`Unknown repo "${request.repo}". Add it under repos: in profile.yaml.`);
    const thread = this.threads.create(request, repoPath);
    this.emit();
    return thread.id;
  }

  archiveThread(id: string, removeWorktree: boolean): void {
    const thread = this.threads.get(id);
    if (thread) this.quests.clearSession(threadKey(thread.creatureId, id));
    this.threads.archive(id, removeWorktree, thread?.repo ? this.profile.repos[thread.repo] : undefined);
    this.emit();
  }

  // Claude Code's own /compact: summarizes the chat in place so it keeps its context but costs less per step.
  compactThread(creatureId: string, threadId?: string): string {
    const creature = this.creature(creatureId);
    const thread = this.threads.get(threadId);
    const sessionKey = threadKey(creature.id, thread?.id);
    if (this.liveChats.has(sessionKey)) throw new Error(`${creature.name} is still working. Compact when the reply is done.`);
    if (!this.quests.sessionFor(sessionKey)) throw new Error('Nothing to compact yet.');
    return this.launch(creature, QuestKind.CHAT, '/compact', { resume: true, record: true, thread });
  }

  // Hand the chat to the real Claude Code terminal UI: same session, same folder, same notes access.
  openThreadInTerminal(creatureId: string, threadId?: string): void {
    const creature = this.creature(creatureId);
    const thread = this.threads.get(threadId);
    const sessionKey = threadKey(creature.id, thread?.id);
    if (this.liveChats.has(sessionKey)) throw new Error(`${creature.name} is still working. Open it in the terminal when the reply is done.`);
    const stored = this.quests.sessionFor(sessionKey);
    if (!stored || stored.startsWith(AGY_SESSION_PREFIX)) throw new Error('This chat has no Claude Code session to open yet.');
    const folder = thread?.cwd ?? creature.cwd;
    const cwd = folder && existsSync(folder) ? folder : this.profile.vault;
    openSessionTerminal({
      bin: (this.profile.engines[creature.engine] ?? this.profile.engines.claude).bin,
      cwd,
      sessionId: stored,
      addDirs: [creature.dir, ...creature.addDirs].filter((dir) => existsSync(dir)),
      claudeConfigDir: this.profile.claudeConfigDir,
    });
  }

  clearThread(creatureId: string, threadId?: string): void {
    this.chatQueue.delete(threadKey(creatureId, threadId));
    this.held.delete(threadKey(creatureId, threadId));
    this.scheduleHeld();
    const removedIds = this.quests.clearThread(creatureId, threadId);
    removedIds.forEach((questId) => {
      this.running.get(questId)?.cancel();
      this.running.delete(questId);
      this.approvals.denyAllForQuest(questId);
    });
    this.emit();
  }

  reorderCreatures(ids: string[]): void {
    const ordered = [
      ...ids.map((id) => this.creatures.find((entry) => entry.id === id)).filter((entry): entry is CreatureType => !!entry),
      ...this.creatures.filter((entry) => !ids.includes(entry.id)),
    ];
    ordered.forEach((creature, index) => {
      if (creature.no !== index + 1) updateCreatureFile(creature, { no: index + 1 });
    });
    this.reloadVault();
  }

  setAutonomy(creatureId: string, autonomy: AutonomyType): void {
    updateCreatureFile(this.creature(creatureId), { autonomy });
    this.reloadVault();
  }

  // Models a creature can pick for its engine. Claude's short list lives in the renderer;
  // engines that can list their own models (Antigravity) are asked. null = no picker.
  async engineModels(engineName: string): Promise<{ id: string; label: string }[] | null> {
    const engine = this.profile.engines[engineName];
    if (!engine || engine.adapter !== EngineAdapter.ANTIGRAVITY) return null;
    return listAntigravityModels(engine.bin, this.env());
  }

  setModel(creatureId: string, model: string): void {
    updateCreatureFile(this.creature(creatureId), { model: model.trim() || undefined });
    this.reloadVault();
  }

  setEffort(creatureId: string, effort: string): void {
    updateCreatureFile(this.creature(creatureId), { effort: effort.trim() || undefined });
    this.reloadVault();
  }

  setEngine(creatureId: string, engine: string): void {
    if (!this.profile.engines[engine]) throw new Error(`Unknown engine "${engine}". Add it under engines: in profile.yaml.`);
    const creature = this.creature(creatureId);
    // A Claude model name means nothing to another engine, so drop it when switching.
    updateCreatureFile(creature, engine === creature.engine ? { engine } : { engine, model: undefined });
    this.reloadVault();
  }

  setSprite(creatureId: string, sourcePath: string): void {
    setOverride(this.profile.spriteOverrides, creatureId, sourcePath);
    this.spriteRev[creatureId] = (this.spriteRev[creatureId] ?? 0) + 1;
    this.emit();
  }

  resetSprite(creatureId: string): void {
    clearOverride(this.profile.spriteOverrides, creatureId);
    this.spriteRev[creatureId] = (this.spriteRev[creatureId] ?? 0) + 1;
    this.emit();
  }

  decideDaycare(decision: DaycareDecisionType): void {
    if (decision.action === DaycareAction.APPROVE) {
      if (approveNote(this.profile.vault, decision.id)) this.quests.countLearned(1);
    } else {
      dismissNote(this.profile.vault, decision.id);
    }
    this.emit();
  }

  switchProfile(profileId: string): void {
    if (profileId === this.profileId) return;
    setActiveProfile(profileId);
    this.loadProfile();
  }

  setDockHidden(hidden: boolean): void {
    this.ui = { ...this.ui, dockHidden: hidden };
    saveUi(this.ui);
    this.emit();
  }

  setDockSize(size: DockSizeType): void {
    this.ui = { ...this.ui, dockSize: size };
    saveUi(this.ui);
    this.emit();
  }

  dockSize(): DockSizeType {
    return this.ui.dockSize;
  }

  getSettings(): ProfileSettingsType {
    return readSettings(this.profile.vault);
  }

  saveSettings(settings: ProfileSettingsType): void {
    writeSettings(this.profile.vault, settings);
    this.profile = loadProfileConfig(this.profile.vault);
    this.profiles = this.profiles.map((entry) => (entry.id === this.profileId ? { ...entry, name: this.profile.name } : entry));
    this.reloadVault();
    void this.refreshAuth();
  }

  prerequisites(): Promise<PrerequisiteType[]> {
    resetFlagSupport();
    return checkPrerequisites(this.profile.engines.claude.bin, this.env());
  }

  setOnboarded(done: boolean): void {
    this.ui = { ...this.ui, onboarded: done };
    saveUi(this.ui);
    this.emit();
  }

  pointCreaturesAt(repoPath: string): number {
    const stale = this.creatures.filter((creature) => !creature.cwd || !existsSync(creature.cwd));
    stale.forEach((creature) => updateCreatureFile(creature, { cwd: repoPath }));
    this.reloadVault();
    return stale.length;
  }

  isDockHidden(): boolean {
    return this.ui.dockHidden;
  }

  createProfile(request: ProfileCreateRequestType): string {
    const name = request.name.trim();
    if (!name) throw new Error('Give the profile a name.');
    if (!request.vault.trim()) throw new Error('Pick a folder for the vault.');
    const id = addProfile(name, request.vault.trim(), request.claudeConfigDir?.trim() || undefined);
    this.loadProfile();
    return id;
  }

  async refreshAuth(): Promise<void> {
    const engine = this.profile.engines.claude;
    this.auth = await checkAuth(engine.bin, this.env());
    this.emit();
  }

  openLogin(): void {
    openLoginTerminal(this.profile.engines.claude.bin, this.profile.claudeConfigDir);
  }

  vaultPath(): string {
    return this.profile.vault;
  }

  // Look for a newer build on GitHub once shortly after launch, then every few hours.
  startUpdateChecks(): void {
    if (this.updateTimer) return;
    setTimeout(() => void this.checkUpdate(), UPDATE_FIRST_CHECK_MS);
    this.updateTimer = setInterval(() => void this.checkUpdate(), UPDATE_CHECK_MS);
  }

  async checkUpdate(): Promise<UpdateInfoType | undefined> {
    this.update = await checkForUpdate();
    this.emit();
    return this.update;
  }

  // Pull the new commits and reinstall, in Terminal so the user sees every step.
  installUpdate(): void {
    const dir = this.update?.sourceDir;
    if (!dir || !existsSync(join(dir, '.git'))) throw new Error('The source folder this app was built from is gone. Pull and run npm run install:app in your checkout.');
    runInTerminal(`cd ${JSON.stringify(dir)} && git pull --ff-only && npm install && npm run install:app`);
  }

  stop(): void {
    this.running.forEach((handle) => handle.cancel());
    this.stopWatching?.();
    if (this.authTimer) clearInterval(this.authTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.heldTimer) clearTimeout(this.heldTimer);
    this.lab.stopAll();
    this.approvals.stop();
  }
}
