import { useEffect, useState } from 'react';
import { NOTE_FLAG_LABEL, NoteFlag, type NoteFlagType } from '@shared/constants';
import type { BrainHealthType } from '@shared/types';
import Badge from '../Badge/Badge';
import { renderIf } from '../../lib/renderIf';
import { BadgeTone, timeAgo, type BadgeToneType } from '../../lib/format';
import './styles.css';

type PropsType = {
  creatureId: string;
  rev: number;
};

const FLAG_TONE: Record<NoteFlagType, BadgeToneType> = {
  [NoteFlag.INLINE]: BadgeTone.DONE,
  [NoteFlag.NEVER_READ]: BadgeTone.FAIL,
  [NoteFlag.STALE]: BadgeTone.WAIT,
  [NoteFlag.LARGE]: BadgeTone.WAIT,
};

const BYTES_PER_KB = 1024;

const BrainHealth = ({ creatureId, rev }: PropsType) => {
  const [health, setHealth] = useState<BrainHealthType | null>(null);
  useEffect(() => {
    let live = true;
    setHealth(null);
    void window.hq.brainHealth(creatureId).then((result) => { if (live) setHealth(result); }).catch(() => undefined);
    return () => { live = false; };
  }, [creatureId, rev]);

  const notes = health?.notes ?? [];
  const totalKb = Math.max(1, Math.round(notes.reduce((sum, note) => sum + note.bytes, 0) / BYTES_PER_KB));
  return (
    <div className="dex-block bhealth">
      <div className="bhealth-head">
        <div className="eyebrow">Brain notes</div>
        {renderIf(!!health, <span className="faint">{notes.length} {notes.length === 1 ? 'note' : 'notes'} · {totalKb} KB · reads counted since {new Date(health?.trackedSince ?? 0).toLocaleDateString()}</span>)}
      </div>
      {renderIf(!!health && notes.length === 0, <p className="faint">No brain notes yet.</p>)}
      <div className="bhealth-list">
        {notes.map((note) => (
          <button key={note.path} className="bhealth-row" title="Open this note" onClick={() => void window.hq.openPath(note.path)}>
            <span className="bhealth-name">{note.label}</span>
            <span className="bhealth-flags">{note.flags.map((flag) => <Badge key={flag} tone={FLAG_TONE[flag]}>{NOTE_FLAG_LABEL[flag]}</Badge>)}</span>
            <span className="bhealth-meta">
              {Math.max(1, Math.round(note.bytes / BYTES_PER_KB))} KB · {note.reads} {note.reads === 1 ? 'read' : 'reads'}{note.lastReadAt ? `, last ${timeAgo(note.lastReadAt)}` : ''} · edited {timeAgo(note.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default BrainHealth;
