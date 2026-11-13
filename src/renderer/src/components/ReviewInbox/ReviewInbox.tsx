import { useCallback, useState } from 'react';
import { ReviewFileStatus, ReviewVerdict } from '@shared/constants';
import { reviewQueue } from '@shared/needsYou';
import type { AppStateType, QuestType, ReviewFileType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import { renderIf } from '../../lib/renderIf';
import { creatureName, timeAgo } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onOpen: (creatureId: string) => void;
};

const STATUS_LABEL: Record<string, string> = {
  [ReviewFileStatus.MODIFIED]: 'edited',
  [ReviewFileStatus.ADDED]: 'new',
  [ReviewFileStatus.UNTRACKED]: 'new',
  [ReviewFileStatus.DELETED]: 'deleted',
  [ReviewFileStatus.UNCHANGED]: 'no changes left',
  [ReviewFileStatus.OUTSIDE]: 'not in a git repo',
};

const cleanError = (error: unknown): string => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const shortPath = (file: ReviewFileType): string => (file.repo && file.path.startsWith(`${file.repo}/`) ? file.path.slice(file.repo.length + 1) : file.path);

const lineClass = (line: string): string => {
  if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(line)) return 'rv-line-meta';
  if (line.startsWith('@@')) return 'rv-line-hunk';
  if (line.startsWith('+')) return 'rv-line-add';
  if (line.startsWith('-')) return 'rv-line-del';
  return '';
};

const Diff = ({ file }: { file: ReviewFileType }) => (
  <div className="rv-file">
    <div className="rv-file-head">
      <span className="rv-file-path selectable">{shortPath(file)}</span>
      <span className="muted">{STATUS_LABEL[file.status] ?? file.status}</span>
    </div>
    {renderIf(!!file.diff, (
      <pre className="rv-diff selectable">
        {file.diff.split('\n').map((line, index) => <span key={index} className={lineClass(line)}>{line}</span>)}
        {file.truncated ? <span className="rv-line-meta">… diff cut short; open the file to see the rest.</span> : null}
      </pre>
    ))}
  </div>
);

const ReviewItem = ({ state, quest, onOpen }: { state: AppStateType; quest: QuestType; onOpen: (creatureId: string) => void }) => {
  const [files, setFiles] = useState<ReviewFileType[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = quest.changedFiles?.length ?? 0;
  // Other quests still waiting for review that touched the same files; discarding restores whole files.
  const overlaps = reviewQueue(state.quests).filter((other) => other.id !== quest.id && other.changedFiles?.some((path) => quest.changedFiles?.includes(path))).length;

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setError(null);
    try {
      setFiles(await window.hq.reviewFiles(quest.id));
    } catch (failure) {
      setError(cleanError(failure));
    }
  }, [open, quest.id]);

  const decide = useCallback(async (verdict: (typeof ReviewVerdict)[keyof typeof ReviewVerdict]) => {
    if (verdict === ReviewVerdict.DISCARDED) {
      const warning = overlaps > 0 ? `\n\n${overlaps === 1 ? 'Another quest waiting for review also changed' : `${overlaps} other quests waiting for review also changed`} some of these files; their changes to them go too.` : '';
      const sure = window.confirm(`Put ${count === 1 ? 'this file' : `these ${count} files`} back to the last commit? Anything else uncommitted in them is lost as well. New files go to the Trash.${warning}`);
      if (!sure) return;
    }
    setBusy(true);
    setError(null);
    try {
      const failed = await window.hq.decideReview({ questId: quest.id, verdict });
      if (failed.length > 0) setError(`Could not restore: ${failed.join(', ')}`);
    } catch (failure) {
      setError(cleanError(failure));
    } finally {
      setBusy(false);
    }
  }, [count, overlaps, quest.id]);

  return (
    <div className="rv-item">
      <div className="rv-row">
        <Sprite state={state} id={quest.creatureId} className="rv-sprite" />
        <button className="rv-main" onClick={() => void toggle()} aria-expanded={open}>
          <span className="rv-title">{quest.title || 'Untitled quest'}</span>
          <span className="rv-meta">
            {creatureName(state, quest.creatureId)} · {count === 1 ? '1 file' : `${count} files`} · {timeAgo(quest.endedAt ?? quest.startedAt)} · {open ? 'hide changes' : 'show changes'}
          </span>
        </button>
        <div className="rv-side">
          <button className="btn sm primary" disabled={busy} onClick={() => void decide(ReviewVerdict.APPROVED)}>Approve</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => onOpen(quest.creatureId)}>Follow up</button>
          <button className="btn sm ghost danger" disabled={busy} onClick={() => void decide(ReviewVerdict.DISCARDED)}>Discard</button>
        </div>
      </div>
      {renderIf(!!error, <p className="rv-error">{error}</p>)}
      {renderIf(open, (
        <div className="rv-files">
          {files === null && !error ? <p className="muted">Loading changes…</p> : null}
          {files?.map((file) => <Diff key={file.path} file={file} />)}
        </div>
      ))}
    </div>
  );
};

// Finished work that changed files, waiting for a look before it counts as done.
const ReviewInbox = ({ state, onOpen }: PropsType) => {
  const queue = reviewQueue(state.quests);
  const approveAll = useCallback(() => {
    if (!window.confirm(`Approve all ${queue.length} quests without looking at their changes?`)) return;
    queue.forEach((quest) => void window.hq.decideReview({ questId: quest.id, verdict: ReviewVerdict.APPROVED }));
  }, [queue]);
  if (queue.length === 0) return null;
  return (
    <div className="panel rv">
      <div className="rv-head">
        <div className="eyebrow">To review · {queue.length}</div>
        {renderIf(queue.length > 1, <button className="btn sm ghost" onClick={approveAll}>Approve all</button>)}
      </div>
      {queue.map((quest) => <ReviewItem key={quest.id} state={state} quest={quest} onOpen={onOpen} />)}
    </div>
  );
};

export default ReviewInbox;
