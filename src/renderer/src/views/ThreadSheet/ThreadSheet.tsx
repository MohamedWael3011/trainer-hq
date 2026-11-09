import { useCallback, useState } from 'react';
import type { AppStateType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creatureId: string;
  creatureName: string;
  onCreated: (threadId: string) => void;
  onClose: () => void;
};

const Source = {
  NONE: 'none',
  BRANCH: 'branch',
  PR: 'pr',
} as const;
type SourceType = (typeof Source)[keyof typeof Source];

const SOURCES: { id: SourceType; label: string }[] = [
  { id: Source.NONE, label: 'Current checkout' },
  { id: Source.BRANCH, label: 'Branch' },
  { id: Source.PR, label: 'Pull request' },
];

const ThreadSheet = ({ state, creatureId, creatureName, onCreated, onClose }: PropsType) => {
  const [title, setTitle] = useState('');
  const [repo, setRepo] = useState('');
  const [source, setSource] = useState<SourceType>(Source.BRANCH);
  const [branch, setBranch] = useState('');
  const [pr, setPr] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await window.hq.createThread({
        creatureId,
        title: title || (source === Source.PR && pr ? `PR ${pr.match(/(\d+)\s*$/)?.[1] ?? pr}` : branch || 'New thread'),
        repo: repo || undefined,
        branch: repo && source === Source.BRANCH ? branch || undefined : undefined,
        pr: repo && source === Source.PR ? pr || undefined : undefined,
        worktree: !!repo && worktree,
      });
      onCreated(id);
    } catch (failure) {
      setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  }, [creatureId, title, repo, source, branch, pr, worktree, onCreated]);

  return (
    <div className="tsheet-wrap" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="tsheet" role="dialog" aria-modal="true" aria-labelledby="tsheet-title">
        <div>
          <h2 id="tsheet-title">New thread with {creatureName}</h2>
          <p className="muted">A separate conversation with its own context, like opening another Claude session. Point it at a branch or PR and it works in its own worktree, so your checkout stays untouched.</p>
        </div>
        <label className="tsheet-field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Delivery instructions · tracking CTA" autoFocus />
        </label>
        <label className="tsheet-field">
          <span>Repo</span>
          <select value={repo} onChange={(event) => setRepo(event.target.value)}>
            <option value="">None, just a separate conversation</option>
            {state.repos.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {renderIf(!!repo, (
          <>
            <div className="seg tsheet-seg" role="group" aria-label="Work on">
              {SOURCES.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={source === entry.id} onClick={() => setSource(entry.id)}>{entry.label}</button>
              ))}
            </div>
            {renderIf(source === Source.BRANCH, (
              <label className="tsheet-field">
                <span>Branch (existing, remote, or a new name)</span>
                <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feat/delivery-instructions" spellCheck={false} />
              </label>
            ))}
            {renderIf(source === Source.PR, (
              <label className="tsheet-field">
                <span>PR number or URL</span>
                <input value={pr} onChange={(event) => setPr(event.target.value)} placeholder="13250" spellCheck={false} />
              </label>
            ))}
            <label className="tsheet-check">
              <input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} />
              <span>Use an isolated worktree (recommended). Without it, the creature works in your current checkout.</span>
            </label>
          </>
        ))}
        {renderIf(!!error, <p className="tsheet-error selectable">{error}</p>)}
        <div className="tsheet-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => void create()} disabled={busy || (source === Source.PR && !!repo && !pr.trim())}>{busy ? 'Preparing…' : 'Create thread'}</button>
        </div>
      </div>
    </div>
  );
};

export default ThreadSheet;
