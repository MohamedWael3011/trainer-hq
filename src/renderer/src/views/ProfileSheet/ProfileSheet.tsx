import { useCallback, useState } from 'react';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  onClose: () => void;
};

const SLUG = /[^a-z0-9]+/g;
const vaultFor = (name: string): string => `~/Documents/trainer-hq-${name.toLowerCase().replace(SLUG, '-').replace(/^-|-$/g, '') || 'new'}`;

const ProfileSheet = ({ onClose }: PropsType) => {
  const [name, setName] = useState('');
  const [vault, setVault] = useState('');
  const [claudeDir, setClaudeDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vaultValue = vault || vaultFor(name);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await window.hq.createProfile({ name, vault: vaultValue, claudeConfigDir: claudeDir || undefined });
      onClose();
    } catch (failure) {
      setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  }, [name, vaultValue, claudeDir, onClose]);

  return (
    <div className="psheet-wrap" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="psheet" role="dialog" aria-modal="true" aria-labelledby="psheet-title">
        <div>
          <h2 id="psheet-title">New profile</h2>
          <p className="muted">A profile is its own vault: its own creatures, notes, repos and engines. Use one for work and one for personal projects.</p>
        </div>
        <label className="psheet-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Personal" autoFocus />
        </label>
        <label className="psheet-field">
          <span>Vault folder</span>
          <input value={vaultValue} onChange={(event) => setVault(event.target.value)} spellCheck={false} />
          <small className="faint">Created with two starter creatures if it doesn't exist. An existing vault is reused as is.</small>
        </label>
        <label className="psheet-field">
          <span>Claude config folder (optional)</span>
          <input value={claudeDir} onChange={(event) => setClaudeDir(event.target.value)} placeholder="~/.claude" spellCheck={false} />
          <small className="faint">Leave empty to use your current Claude login. Point it at another folder to use a different Claude account for this profile.</small>
        </label>
        {renderIf(!!error, <p className="psheet-error">{error}</p>)}
        <div className="psheet-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create and switch'}</button>
        </div>
      </div>
    </div>
  );
};

export default ProfileSheet;
