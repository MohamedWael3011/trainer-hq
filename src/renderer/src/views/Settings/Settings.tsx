import { useCallback, useEffect, useState } from 'react';
import { DOCK_SHORTCUT, EngineAdapter, NOTCH_SHORTCUT } from '@shared/constants';
import type { AppStateType, ProfileSettingsType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onRestartOnboarding: () => void;
};

const PERCENT = 100;
const SHORTCUTS: [string, string][] = [
  [NOTCH_SHORTCUT.replace('Alt', '⌥').replace('+', ' '), 'Open or close the notch'],
  [DOCK_SHORTCUT.replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, ' '), 'Minimize, restore or bring back the route dock'],
  ['⌘ .', 'Stop the latest running quest (in the notch)'],
  ['⇥', 'Switch creature (in the notch)'],
  ['⌥ ↑ / ⌥ ↓', 'Reorder the selected creature (roster)'],
];

const cleanError = (error: unknown): string => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

const Settings = ({ state, onRestartOnboarding }: PropsType) => {
  const [draft, setDraft] = useState<ProfileSettingsType | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [openAtLogin, setOpenAtLogin] = useState(false);

  const load = useCallback(() => {
    void window.hq.getSettings().then((settings) => {
      setDraft(settings);
      setSaved(JSON.stringify(settings));
    });
  }, []);

  useEffect(() => {
    load();
    void window.hq.getOpenAtLogin().then(setOpenAtLogin);
  }, [load, state.profile.id]);

  const update = useCallback((change: (current: ProfileSettingsType) => ProfileSettingsType) => {
    setDraft((current) => (current ? change(current) : current));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setError(null);
    try {
      await window.hq.saveSettings(draft);
      load();
    } catch (failure) {
      setError(cleanError(failure));
    }
  }, [draft, load]);

  const pick = useCallback(async (current: string, apply: (path: string) => void) => {
    const path = await window.hq.pickFolder(current || undefined);
    if (path) apply(path);
  }, []);

  if (!draft) return <section className="settings"><p className="muted">Loading settings…</p></section>;
  const dirty = JSON.stringify(draft) !== saved;

  return (
    <section className="settings">
      <header className="settings-head">
        <div>
          <h2>Settings</h2>
          <p className="muted">Saved to <code>{draft.vault}/profile.yaml</code>. Comments and formatting there are kept.</p>
        </div>
        <div className="settings-actions">
          <button className="btn sm ghost" disabled={!dirty} onClick={load}>Revert</button>
          <button className="btn primary sm" disabled={!dirty} onClick={() => void save()}>Save</button>
        </div>
      </header>
      {renderIf(!!error, <p className="settings-error selectable">{error}</p>)}

      <div className="panel settings-block">
        <div className="eyebrow">Profile</div>
        <label className="settings-field"><span>Name</span><input value={draft.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} /></label>
        <div className="settings-field">
          <span>Vault</span>
          <div className="settings-inline"><code className="settings-path">{draft.vault}</code><button className="btn sm ghost" onClick={() => void window.hq.openPath(draft.vault)}>Open</button></div>
        </div>
        <label className="settings-field">
          <span>Claude config folder (optional)</span>
          <div className="settings-inline">
            <input value={draft.claudeConfigDir} placeholder="Leave empty to use your normal Claude login" onChange={(event) => update((current) => ({ ...current, claudeConfigDir: event.target.value }))} spellCheck={false} />
            <button className="btn sm" onClick={() => void pick(draft.claudeConfigDir, (path) => update((current) => ({ ...current, claudeConfigDir: path })))}>Choose…</button>
          </div>
          <small className="faint">Only for a second Claude account. Setting it to ~/.claude makes Claude look for a different login, so leave it empty for the default.</small>
        </label>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Repos</div>
        <p className="faint">Shown when hatching creatures and creating threads. Creatures can be pointed at any of them.</p>
        {draft.repos.map((repo, index) => (
          <div key={index} className="settings-inline">
            <input className="settings-short" value={repo.name} onChange={(event) => update((current) => ({ ...current, repos: current.repos.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) }))} />
            <input value={repo.path} onChange={(event) => update((current) => ({ ...current, repos: current.repos.map((entry, i) => (i === index ? { ...entry, path: event.target.value } : entry)) }))} spellCheck={false} />
            <button className="btn sm ghost danger" onClick={() => update((current) => ({ ...current, repos: current.repos.filter((_, i) => i !== index) }))}>Remove</button>
          </div>
        ))}
        <button className="btn sm settings-add" onClick={() => void pick('', (path) => update((current) => ({ ...current, repos: [...current.repos, { name: basename(path), path }] })))}>+ Add repo…</button>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Engines</div>
        <p className="faint">claude runs your installed Claude Code. Any other CLI agent works through the generic adapter: {'{prompt}'} and {'{system}'} are replaced in its arguments; without {'{prompt}'} the prompt goes to stdin.</p>
        {draft.engines.map((engine, index) => (
          <div key={index} className="settings-inline">
            <input className="settings-short" value={engine.name} disabled={engine.adapter === EngineAdapter.CLAUDE} onChange={(event) => update((current) => ({ ...current, engines: current.engines.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) }))} />
            <input className="settings-short" value={engine.bin} placeholder="command" onChange={(event) => update((current) => ({ ...current, engines: current.engines.map((entry, i) => (i === index ? { ...entry, bin: event.target.value } : entry)) }))} spellCheck={false} />
            <input value={engine.args.join(' ')} placeholder={engine.adapter === EngineAdapter.CLAUDE ? 'managed by Trainer HQ' : '-p {prompt}'} disabled={engine.adapter === EngineAdapter.CLAUDE} onChange={(event) => update((current) => ({ ...current, engines: current.engines.map((entry, i) => (i === index ? { ...entry, args: event.target.value.split(' ') } : entry)) }))} spellCheck={false} />
            {renderIf(engine.adapter !== EngineAdapter.CLAUDE, <button className="btn sm ghost danger" onClick={() => update((current) => ({ ...current, engines: current.engines.filter((_, i) => i !== index) }))}>Remove</button>)}
          </div>
        ))}
        <button className="btn sm settings-add" onClick={() => update((current) => ({ ...current, engines: [...current.engines, { name: 'gemini', adapter: EngineAdapter.CLI, bin: 'gemini', args: ['-p', '{prompt}'] }] }))}>+ Add CLI engine</button>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Full auto guard</div>
        <div className="settings-grid">
          <label className="settings-field"><span>Time limit per quest (minutes)</span><input type="number" min={1} value={draft.guard.maxMinutes} onChange={(event) => update((current) => ({ ...current, guard: { ...current.guard, maxMinutes: Number(event.target.value) || 1 } }))} /></label>
          <label className="settings-field"><span>Don't start above this 5-hour plan usage (%)</span><input type="number" min={1} max={100} value={Math.round(draft.guard.maxPlanUsage * PERCENT)} onChange={(event) => update((current) => ({ ...current, guard: { ...current.guard, maxPlanUsage: (Number(event.target.value) || 1) / PERCENT } }))} /></label>
        </div>
        <label className="settings-check"><input type="checkbox" checked={draft.guard.worktree} onChange={(event) => update((current) => ({ ...current, guard: { ...current.guard, worktree: event.target.checked } }))} /><span>Run full-auto quests in their own git worktree</span></label>
        <label className="settings-field">
          <span>Extra always-deny rules (one per line, Claude Code permission syntax)</span>
          <textarea rows={4} value={draft.guard.alwaysDeny.join('\n')} onChange={(event) => update((current) => ({ ...current, guard: { ...current.guard, alwaysDeny: event.target.value.split('\n') } }))} spellCheck={false} />
          <small className="faint">Always blocked as well: {draft.guard.builtInDeny.join(', ')}</small>
        </label>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Day Care</div>
        <label className="settings-check"><input type="checkbox" checked={draft.daycare.autoPropose} onChange={(event) => update((current) => ({ ...current, daycare: { ...current.daycare, autoPropose: event.target.checked } }))} /><span>Suggest notes after each chat</span></label>
        <label className="settings-check"><input type="checkbox" checked={draft.daycare.autoApproveFullAuto} onChange={(event) => update((current) => ({ ...current, daycare: { ...current.daycare, autoApproveFullAuto: event.target.checked } }))} /><span>Let full-auto creatures with review: false save notes without asking</span></label>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Environment</div>
        <p className="faint">Extra environment variables for every creature. ~ is expanded.</p>
        {draft.env.map((entry, index) => (
          <div key={index} className="settings-inline">
            <input className="settings-short" value={entry.key} placeholder="NAME" onChange={(event) => update((current) => ({ ...current, env: current.env.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)) }))} spellCheck={false} />
            <input value={entry.value} placeholder="value" onChange={(event) => update((current) => ({ ...current, env: current.env.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)) }))} spellCheck={false} />
            <button className="btn sm ghost danger" onClick={() => update((current) => ({ ...current, env: current.env.filter((_, i) => i !== index) }))}>Remove</button>
          </div>
        ))}
        <button className="btn sm settings-add" onClick={() => update((current) => ({ ...current, env: [...current.env, { key: '', value: '' }] }))}>+ Add variable</button>
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">Lab (optional)</div>
        <label className="settings-check"><input type="checkbox" checked={draft.lab.enabled} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, enabled: event.target.checked } }))} /><span>Enable the Lab tab for a render harness skill</span></label>
        {renderIf(draft.lab.enabled, (
          <div className="settings-grid">
            <label className="settings-field"><span>Title</span><input value={draft.lab.title} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, title: event.target.value } }))} /></label>
            <label className="settings-field"><span>Port</span><input type="number" value={draft.lab.port} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, port: Number(event.target.value) || 8787 } }))} /></label>
            <label className="settings-field"><span>Harness skill folder</span><div className="settings-inline"><input value={draft.lab.skill} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, skill: event.target.value } }))} spellCheck={false} /><button className="btn sm" onClick={() => void pick(draft.lab.skill, (path) => update((current) => ({ ...current, lab: { ...current.lab, skill: path } })))}>Choose…</button></div></label>
            <label className="settings-field"><span>Workspaces home</span><div className="settings-inline"><input value={draft.lab.home} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, home: event.target.value } }))} spellCheck={false} /><button className="btn sm" onClick={() => void pick(draft.lab.home, (path) => update((current) => ({ ...current, lab: { ...current.lab, home: path } })))}>Choose…</button></div></label>
            <label className="settings-field"><span>Examples folder (in the skill)</span><input value={draft.lab.examples} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, examples: event.target.value } }))} spellCheck={false} /></label>
            <label className="settings-field"><span>Workspace marker file</span><input value={draft.lab.markerFile} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, markerFile: event.target.value } }))} spellCheck={false} /></label>
            <label className="settings-field"><span>Server script (in a workspace)</span><input value={draft.lab.serverScript} onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, serverScript: event.target.value } }))} spellCheck={false} /></label>
            <label className="settings-field"><span>Default clock / time zone</span><div className="settings-inline"><input value={draft.lab.now} placeholder="ISO time, empty = now" onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, now: event.target.value } }))} spellCheck={false} /><input className="settings-short" value={draft.lab.tz} placeholder="UTC" onChange={(event) => update((current) => ({ ...current, lab: { ...current.lab, tz: event.target.value } }))} spellCheck={false} /></div></label>
          </div>
        ))}
      </div>

      <div className="panel settings-block">
        <div className="eyebrow">App</div>
        <label className="settings-check"><input type="checkbox" checked={openAtLogin} onChange={(event) => { setOpenAtLogin(event.target.checked); void window.hq.setOpenAtLogin(event.target.checked); }} /><span>Launch at login (dock and notch only, no window)</span></label>
        <label className="settings-check"><input type="checkbox" checked={!state.ui.dockHidden} onChange={(event) => void window.hq.setDockHidden(!event.target.checked)} /><span>Show the route dock</span></label>
        <div className="settings-shortcuts">
          {SHORTCUTS.map(([keys, label]) => <div key={keys} className="settings-shortcut"><span className="kbd">{keys}</span><span>{label}</span></div>)}
        </div>
        <div className="settings-inline">
          <button className="btn sm" onClick={onRestartOnboarding}>Run onboarding again</button>
          <button className="btn sm ghost" onClick={() => void window.hq.openPath(`${draft.vault}/sprites/overrides`)}>Open sprite overrides</button>
        </div>
      </div>
    </section>
  );
};

export default Settings;
