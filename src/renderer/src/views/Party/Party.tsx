import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AttachmentKind, QuestKind } from '@shared/constants';
import type { AppStateType, AttachmentInfoType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import QuestLog from '../../components/QuestLog/QuestLog';
import ApprovalCard from '../../components/ApprovalCard/ApprovalCard';
import AttachmentChip from '../../components/AttachmentChip/AttachmentChip';
import ThreadSheet from '../ThreadSheet/ThreadSheet';
import CreatureControls from '../../components/CreatureControls/CreatureControls';
import { renderIf } from '../../lib/renderIf';
import { AUTONOMY_INFO, creatureById, isLive } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creatureId: string;
};

const HISTORY = 12;
const COMPOSER_MAX_HEIGHT = 200;

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
  const lastEventCount = quests[quests.length - 1]?.events.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [creatureId, quests.length, lastEventCount, approvals.length]);

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
              <button className="btn sm ghost" onClick={() => { void window.hq.archiveThread(thread.id, false); setThreadId(undefined); }}>Archive</button>
              {renderIf(!!thread.worktree, <button className="btn sm ghost danger" onClick={() => { void window.hq.archiveThread(thread.id, true); setThreadId(undefined); }}>Archive + remove worktree</button>)}
            </span>
          </div>
        ) : null)}
      </div>
      <div className="party-log">
        {renderIf(quests.length === 0, <p className="party-hello muted">{creature.blurb || `${creature.name} is ready.`} What do you need?</p>)}
        {quests.map((quest) => <QuestLog key={quest.id} state={state} quest={quest} />)}
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
      <form className="party-composer" onSubmit={send}>
        <label className="party-attach" title="Attach files">
          +
          <input type="file" multiple onChange={onPick} />
        </label>
        <textarea ref={inputRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} onPaste={onPaste} placeholder={busy ? `${creature.name} is working. You can queue another message.` : `Message ${creature.name} · Shift+Enter for a new line · drop or paste files and screenshots`} />
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
