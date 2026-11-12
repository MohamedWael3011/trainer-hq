import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AttachmentKind, EngineAdapter, QuestKind } from '@shared/constants';
import type { AppStateType, AttachmentInfoType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import QuestLog from '../../components/QuestLog/QuestLog';
import ApprovalCard from '../../components/ApprovalCard/ApprovalCard';
import AttachmentChip from '../../components/AttachmentChip/AttachmentChip';
import ThreadSheet from '../ThreadSheet/ThreadSheet';
import CreatureControls from '../../components/CreatureControls/CreatureControls';
import { renderIf } from '../../lib/renderIf';
import { useQuestLive } from '../../hooks/useQuestLive';
import { AUTONOMY_INFO, creatureById, isLive } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creatureId: string;
};

const HISTORY = 12;
const COMPOSER_MAX_HEIGHT = 200;
// From here on the chat shows how close the 5-hour plan window is to its limit.
const PLAN_WARN_AT = 0.8;
// Past this size every step resends a lot; suggest compacting before auto-compact has to.
const SUGGEST_COMPACT_TOKENS = 70_000;
const DISMISSED_COMPACT_KEY = 'thq.compactHintDismissed';
const COMPACT_HINT_REGROW_TOKENS = 30_000;

const readDismissed = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_COMPACT_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const Party = ({ state, creatureId }: PropsType) => {
  const creature = creatureById(state, creatureId);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<AttachmentInfoType[]>([]);
  const [dragging, setDragging] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [creatingThread, setCreatingThread] = useState(false);
  const threads = useMemo(
    () => state.threads.filter((thread) => thread.creatureId === creatureId && !thread.archived).sort((a, b) => a.createdAt - b.createdAt),
    [state.threads, creatureId],
  );
  const thread = threads.find((entry) => entry.id === threadId);

  useEffect(() => {
    setThreadId(undefined);
  }, [creatureId]);
  const dragDepth = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    // Files from Finder have a path; pasted screenshots don't, so save those first.
    const paths = (await Promise.all(Array.from(files).map(async (file) => {
      const path = window.hq.pathForFile(file);
      if (path) return path;
      return window.hq.savePastedFile(await file.arrayBuffer(), file.type).catch(() => '');
    }))).filter(Boolean);
    if (paths.length === 0) return;
    const quoted = paths.map((path) => (/\s/.test(path) ? `"${path}"` : path)).join(' ');
    const input = inputRef.current;
    setDraft((current) => {
      const at = input?.selectionStart ?? current.length;
      const before = current.slice(0, at);
      const after = current.slice(at);
      const left = before && !before.endsWith(' ') ? `${before} ` : before;
      const right = after && !after.startsWith(' ') ? ` ${after}` : after;
      return `${left}${quoted}${right || ' '}`;
    });
    requestAnimationFrame(() => input?.focus());
    const infos = await Promise.all(paths.map((path) => window.hq.inspectAttachment(path)));
    const skills = infos.filter((info) => info.kind === AttachmentKind.SKILL);
    setAttachments((current) => [...current, ...skills.filter((info) => !current.some((entry) => entry.path === info.path))]);
  }, []);

  const removeAttachment = useCallback((path: string) => {
    setAttachments((current) => current.filter((entry) => entry.path !== path));
  }, []);

  const resetDrag = useCallback(() => {
    dragDepth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    const onWindowLeave = (event: globalThis.DragEvent) => {
      if (!event.relatedTarget) resetDrag();
    };
    window.addEventListener('dragleave', onWindowLeave);
    window.addEventListener('drop', resetDrag);
    window.addEventListener('dragend', resetDrag);
    window.addEventListener('mousemove', resetDrag);
    window.addEventListener('blur', resetDrag);
    return () => {
      window.removeEventListener('dragleave', onWindowLeave);
      window.removeEventListener('drop', resetDrag);
      window.removeEventListener('dragend', resetDrag);
      window.removeEventListener('mousemove', resetDrag);
      window.removeEventListener('blur', resetDrag);
    };
  }, [resetDrag]);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    resetDrag();
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
  }, [addFiles, resetDrag]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }, [addFiles]);

  const onPick = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = '';
  }, [addFiles]);
  const quests = useMemo(
    () => state.quests.filter((quest) => quest.creatureId === creatureId && (quest.kind === QuestKind.CHAT || quest.kind === QuestKind.HANDOFF) && quest.threadId === threadId).slice(0, HISTORY).reverse(),
    [state.quests, creatureId, threadId],
  );
  const approvals = state.approvals.filter((approval) => approval.creatureId === creatureId);
  const busy = quests.some(isLive);
  const isClaude = !!creature && state.engineAdapters[creature.engine] === EngineAdapter.CLAUDE;
  const canCompact = isClaude && !busy && quests.length > 0;
  const queued = state.queued.find((entry) => entry.creatureId === creature?.id && entry.threadId === thread?.id);
  const held = state.held.find((entry) => entry.creatureId === creature?.id && entry.threadId === thread?.id);
  const planUsage = state.usage?.fiveHour ?? 0;
  const resetsAt = state.usage?.resetsAt;
  const showPlanWarning = isClaude && !held && planUsage >= PLAN_WARN_AT;
  // quests run oldest to newest, so the last one with a size is the chat's current size.
  const contextTokens = [...quests].reverse().find((quest) => quest.usage?.contextTokens)?.usage?.contextTokens ?? 0;
  const chatKey = `${creatureId}:${threadId ?? ''}`;
  const [dismissedCompact, setDismissedCompact] = useState(readDismissed);
  // "Not now" holds until the chat grows by another step's worth of reading.
  const dismissedAt = dismissedCompact[chatKey];
  const showCompactHint = canCompact && !held && contextTokens >= SUGGEST_COMPACT_TOKENS
    && (dismissedAt === undefined || contextTokens >= dismissedAt + COMPACT_HINT_REGROW_TOKENS || contextTokens < dismissedAt);
  const dismissCompact = (): void => {
    const next = { ...dismissedCompact, [chatKey]: contextTokens };
    setDismissedCompact(next);
    try {
      localStorage.setItem(DISMISSED_COMPACT_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; the hint just comes back next time.
    }
  };
  const lastEventCount = quests[quests.length - 1]?.events.length ?? 0;
  const lastQuest = quests[quests.length - 1];
  const lastLive = useQuestLive(lastQuest && isLive(lastQuest) ? lastQuest.id : undefined);
  // Follow the reply as it types, one line at a time rather than on every token.
  const draftLines = lastLive?.draft.split('\n').length ?? 0;
  const draftChunks = Math.floor((lastLive?.draft.length ?? 0) / 160);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [creatureId, quests.length, lastEventCount, approvals.length, draftLines, draftChunks]);

  const send = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !creature) return;
    void window.hq.chat({ creatureId: creature.id, text, threadId });
    setDraft('');
    setAttachments([]);
  }, [draft, creature, threadId]);

  // Enter sends, Shift+Enter adds a line. Skip while an IME is composing (e.g. Arabic or Japanese input).
  const onComposerKey = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }, [send]);

  if (!creature) return <div className="party-empty">Hatch your first creature to start.</div>;
  const autonomy = AUTONOMY_INFO[creature.autonomy];

  return (
    <section
      className={`party${dragging ? ' party-dragging' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="party-head">
        <div className="party-avatar"><Sprite state={state} id={creature.id} className="party-avatar-sprite" /></div>
        <div className="party-who">
          <h2>{creature.name}</h2>
          <p className="muted">{creature.role}</p>
          <div className="party-meta">
            <CreatureControls state={state} creature={creature} />
            {renderIf(!!creature.cwd, <Badge>{creature.cwd?.split('/').pop()}</Badge>)}
          </div>
        </div>
      </header>
      <div className="party-threads">
        <div className="party-tabs" role="tablist" aria-label="Threads">
          <button role="tab" aria-selected={!threadId} className="party-tab" onClick={() => setThreadId(undefined)}>Main</button>
          {threads.map((entry) => {
            const liveHere = state.quests.some((quest) => quest.threadId === entry.id && isLive(quest));
            return (
              <button key={entry.id} role="tab" aria-selected={threadId === entry.id} className="party-tab" onClick={() => setThreadId(entry.id)} title={entry.cwd ?? entry.title}>
                {renderIf(liveHere, <i className="party-tab-live" />)}
                <span className="party-tab-title">{entry.title}</span>
              </button>
            );
          })}
          <button className="party-tab party-tab-add" onClick={() => setCreatingThread(true)}>+ Thread</button>
          {renderIf(!thread && canCompact, (
            <button
              className="btn sm ghost party-clear-btn"
              onClick={() => void window.hq.openThreadInTerminal(creature.id)}
              title="Continue this chat in Claude Code in Terminal (same session)"
            >
              Terminal
            </button>
          ))}
          {renderIf(!thread && canCompact, (
            <button
              className="btn sm ghost party-clear-btn"
              onClick={() => void window.hq.compactThread(creature.id)}
              title="Summarize this chat in place (Claude Code /compact): keeps the context, costs less per step"
            >
              Compact
            </button>
          ))}
          {renderIf(!thread && quests.length > 0, (
            <button
              className="btn sm ghost party-clear-btn"
              onClick={() => void window.hq.clearThread(creature.id)}
              title="Clear Main chat history and start a fresh session"
            >
              Clear
            </button>
          ))}
        </div>
        {renderIf(!!thread, thread ? (
          <div className="party-thread-info">
            {renderIf(!!thread.repo, <Badge>{thread.repo}</Badge>)}
            {renderIf(!!thread.branch, <Badge>{thread.branch}</Badge>)}
            {renderIf(!!thread.pr, <Badge>PR {thread.pr}</Badge>)}
            {renderIf(!!thread.worktree, <Badge tone={autonomy.tone}>worktree</Badge>)}
            {renderIf(!!thread.note, <span className="faint">{thread.note}</span>)}
            <span className="party-thread-actions">
              {renderIf(!!thread.cwd, <button className="btn sm ghost" onClick={() => void window.hq.openPath(thread.cwd)}>Open folder</button>)}
 {renderIf(canCompact, <button className="btn sm ghost" title="Continue this chat in Claude Code in Terminal (same session)" onClick={() => void window.hq.openThreadInTerminal(creature.id, thread.id)}>Terminal</button>)}
              {renderIf(canCompact, <button className="btn sm ghost" title="Summarize this chat in place (Claude Code /compact)" onClick={() => void window.hq.compactThread(creature.id, thread.id)}>Compact</button>)}
              {renderIf(quests.length > 0, <button className="btn sm ghost" onClick={() => void window.hq.clearThread(creature.id, thread.id)}>Clear</button>)}
              <button className="btn sm ghost" onClick={() => { void window.hq.archiveThread(thread.id, false); setThreadId(undefined); }}>Archive</button>
              {renderIf(!!thread.worktree, <button className="btn sm ghost danger" onClick={() => { void window.hq.archiveThread(thread.id, true); setThreadId(undefined); }}>Archive + remove worktree</button>)}
            </span>
          </div>
        ) : null)}
      </div>
      <div className="party-log">
        {renderIf(quests.length === 0, <p className="party-hello muted">{creature.blurb || `${creature.name} is ready.`} What do you need?</p>)}
        {quests.map((quest) => <QuestLog key={quest.id} state={state} quest={quest} />)}
        {renderIf(!!queued, (
          <div className="party-queued">
            {queued?.texts.map((text, index) => <div key={index} className="ql-me party-queued-msg selectable">{text}</div>)}
            <div className="party-queued-note">
              <span>{queued && queued.texts.length > 1 ? 'Queued: these send' : 'Queued: sends'} when this reply finishes{isClaude ? ' (files need a turn of their own)' : ''}.</span>
              <button className="btn sm ghost" onClick={() => void window.hq.cancelQueued(creature.id, thread?.id)}>Cancel</button>
            </div>
          </div>
        ))}
        {approvals.map((approval) => <ApprovalCard key={approval.id} state={state} approval={approval} />)}
        <div ref={endRef} />
      </div>
      {renderIf(attachments.length > 0, (
        <div className="party-attachments">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.path} attachment={attachment} creatureId={creature.id} creatureName={creature.name} onRemove={removeAttachment} />
          ))}
        </div>
      ))}
      {renderIf(!!held, held ? (
        <div className="party-limit party-limit-held" role="status">
          <span>
            Plan limit reached. {held.count === 1 ? 'Your message sends' : `${held.count} messages send`} automatically at <b>{clock(held.resumeAt)}</b>.
          </span>
          <span className="party-limit-actions">
            <button className="btn sm ghost" onClick={() => void window.hq.sendHeldNow(creature.id, thread?.id)}>Try now</button>
            <button className="btn sm ghost" onClick={() => void window.hq.cancelHeld(creature.id, thread?.id)}>Cancel</button>
          </span>
        </div>
      ) : null)}
      {renderIf(showPlanWarning, (
        <div className="party-limit" role="status">
          <span>Plan at <b>{Math.round(planUsage * 100)}%</b>{resetsAt && resetsAt > Date.now() ? `, resets ${clock(resetsAt)}` : ''}. If it runs out, messages wait for the reset.</span>
        </div>
      ))}
      {renderIf(showCompactHint, (
        <div className="party-limit party-limit-info" role="status">
          <span>Chat is at <b>{Math.round(contextTokens / 1000)}k tokens</b>, resent every step. Compacting makes the next ones cheaper.</span>
          <span className="party-limit-actions">
            <button className="btn sm ghost" onClick={() => void window.hq.compactThread(creature.id, thread?.id)}>Compact</button>
            <button className="btn sm ghost" onClick={dismissCompact}>Not now</button>
          </span>
        </div>
      ))}
      <form className="party-composer" onSubmit={send}>
        <label className="party-attach" title="Attach files">
          +
          <input type="file" multiple onChange={onPick} />
        </label>
        <textarea ref={inputRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} onPaste={onPaste} placeholder={held ? `Plan limit reached. Messages you send now go out at ${clock(held.resumeAt)}.` : busy ? `${creature.name} is working. ${isClaude ? 'Send a message to steer it mid-task.' : 'New messages wait until it finishes.'}` : `Message ${creature.name} · Shift+Enter for a new line · drop or paste files and screenshots`} />
        <button className="btn primary sm" type="submit" disabled={!draft.trim()}>Send</button>
      </form>
      {renderIf(dragging, <div className="party-drop">Drop files for {creature.name}</div>)}
      {renderIf(creatingThread, (
        <ThreadSheet
          state={state}
          creatureId={creature.id}
          creatureName={creature.name}
          onCreated={(id) => { setThreadId(id); setCreatingThread(false); }}
          onClose={() => setCreatingThread(false)}
        />
      ))}
    </section>
  );
};

export default Party;
