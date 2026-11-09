import { useCallback, useEffect, useState } from 'react';
import type { AppStateType, PrerequisiteType, ProfileSettingsType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import { renderIf } from '../../lib/renderIf';
import { AUTONOMY_INFO, BadgeTone } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onFinish: () => void;
};

const Step = {
  WELCOME: 0,
  TOOLS: 1,
  PROFILE: 2,
  REPOS: 3,
  PARTY: 4,
  DONE: 5,
} as const;

const STEP_LABELS = ['Welcome', 'Tools', 'Profile', 'Repos', 'Party', 'Shortcuts'];
const LAST_STEP = Step.DONE;
const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

const Onboarding = ({ state, onFinish }: PropsType) => {
  const [step, setStep] = useState<number>(Step.WELCOME);
  const [prereqs, setPrereqs] = useState<PrerequisiteType[] | null>(null);
  const [settings, setSettings] = useState<ProfileSettingsType | null>(null);
  const [name, setName] = useState('');
  const [pointAt, setPointAt] = useState('');
  const [pointed, setPointed] = useState<number | null>(null);
  const [openAtLogin, setOpenAtLogin] = useState(true);

  const checkTools = useCallback(() => {
    setPrereqs(null);
    void window.hq.checkPrerequisites().then(setPrereqs);
  }, []);

  useEffect(() => {
    checkTools();
    void window.hq.getSettings().then((loaded) => {
      setSettings(loaded);
      setName(loaded.name);
    });
  }, [checkTools, state.profile.id]);

  const saveSettings = useCallback(async (change: (current: ProfileSettingsType) => ProfileSettingsType) => {
    if (!settings) return;
    const next = change(settings);
    setSettings(next);
    await window.hq.saveSettings(next);
  }, [settings]);

  const addRepo = useCallback(async () => {
    const path = await window.hq.pickFolder();
    if (!path) return;
    await saveSettings((current) => ({ ...current, repos: [...current.repos.filter((repo) => repo.path !== path), { name: basename(path), path }] }));
    setPointAt((current) => current || path);
  }, [saveSettings]);

  const useOtherVault = useCallback(async () => {
    const path = await window.hq.pickFolder('~/Documents');
    if (!path) return;
    await window.hq.createProfile({ name: name || 'My Party', vault: path });
  }, [name]);

  const next = useCallback(async () => {
    if (step === Step.PROFILE && settings && name.trim() && name !== settings.name) await saveSettings((current) => ({ ...current, name: name.trim() }));
    if (step === Step.REPOS && pointAt) setPointed(await window.hq.pointCreaturesAt(pointAt));
    if (step === LAST_STEP) {
      await window.hq.setOpenAtLogin(openAtLogin);
      await window.hq.setOnboarded(true);
      onFinish();
      return;
    }
    setStep((current) => current + 1);
  }, [step, settings, name, pointAt, openAtLogin, saveSettings, onFinish]);

  const requiredMissing = (prereqs ?? []).some((item) => item.required && !item.ok);

  return (
    <div className="onb-wrap">
      <div className="onb" role="dialog" aria-modal="true" aria-label="Welcome to Trainer HQ">
        <ol className="onb-steps">
          {STEP_LABELS.map((label, index) => (
            <li key={label} className={index === step ? 'onb-step-now' : index < step ? 'onb-step-done' : ''}>{label}</li>
          ))}
        </ol>

        {renderIf(step === Step.WELCOME, (
          <div className="onb-body onb-hero">
            <Sprite state={state} id="egg" className="onb-egg" />
            <h1>Welcome to Trainer HQ</h1>
            <p>Your AI coding agents, as a party of pixel creatures. Each creature is a specialist with its own notes, skills, engine and autonomy. They walk around a dock above your Dock, answer from the notch with <span className="kbd">⌥ Space</span>, and you manage everything here.</p>
            <p className="muted">This takes about two minutes. Nothing leaves your Mac: Trainer HQ runs your own Claude Code login and keeps everything in a folder of markdown files you own.</p>
          </div>
        ))}

        {renderIf(step === Step.TOOLS, (
          <div className="onb-body">
            <h2>Check your tools</h2>
            <p className="muted">Trainer HQ drives command-line agents you already have.</p>
            <div className="onb-list">
              {(prereqs ?? []).map((item) => (
                <div key={item.id} className="onb-check">
                  <Badge tone={item.ok ? BadgeTone.DONE : item.required ? BadgeTone.FAIL : BadgeTone.WAIT} dot>{item.ok ? 'ready' : item.required ? 'needed' : 'optional'}</Badge>
                  <div><b>{item.label}</b><p className="faint selectable">{item.detail}</p></div>
                </div>
              ))}
              {renderIf(!prereqs, <p className="faint">Checking…</p>)}
            </div>
            <div className="onb-row">
              <button className="btn sm" onClick={checkTools}>Check again</button>
              {renderIf(!!prereqs?.some((item) => item.id === 'auth' && !item.ok), <button className="btn sm primary" onClick={() => void window.hq.openLogin()}>Sign in to Claude</button>)}
            </div>
          </div>
        ))}

        {renderIf(step === Step.PROFILE, (
          <div className="onb-body">
            <h2>Your profile and vault</h2>
            <p className="muted">A profile is one vault: a folder of markdown with your creatures, their notes and settings. Open it in Obsidian if you like. Add a second profile later (for example work and personal) with + Profile.</p>
            <label className="onb-field"><span>Profile name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My Party" /></label>
            <div className="onb-field">
              <span>Vault folder</span>
              <div className="onb-row"><code className="onb-path">{state.profile.vault}</code><button className="btn sm ghost" onClick={() => void window.hq.openPath(state.profile.vault)}>Open</button><button className="btn sm" onClick={() => void useOtherVault()}>Use another folder…</button></div>
            </div>
          </div>
        ))}

        {renderIf(step === Step.REPOS, (
          <div className="onb-body">
            <h2>Add your code</h2>
            <p className="muted">Pick the repos your creatures work in. You'll see them when hatching creatures and starting threads on a branch or PR.</p>
            <div className="onb-list">
              {(settings?.repos ?? []).map((repo) => (
                <label key={repo.path} className="onb-repo">
                  <input type="radio" name="point-at" checked={pointAt === repo.path} onChange={() => setPointAt(repo.path)} />
                  <b>{repo.name}</b><code className="faint">{repo.path}</code>
                </label>
              ))}
              {renderIf((settings?.repos ?? []).length === 0, <p className="faint">No repos yet.</p>)}
            </div>
            <div className="onb-row">
              <button className="btn sm primary" onClick={() => void addRepo()}>+ Add repo…</button>
              {renderIf(!!pointAt, <span className="faint">Starter creatures without a working folder will use the selected repo.</span>)}
            </div>
          </div>
        ))}

        {renderIf(step === Step.PARTY, (
          <div className="onb-body">
            <h2>Meet your party</h2>
            {renderIf(pointed !== null && pointed > 0, <p className="onb-note">Pointed {pointed} creature{pointed === 1 ? '' : 's'} at {basename(pointAt)}.</p>)}
            <div className="onb-party">
              {state.creatures.map((creature) => (
                <div key={creature.id} className="onb-mon">
                  <Sprite state={state} id={creature.id} className="onb-mon-sprite" />
                  <div>
                    <b>{creature.name}</b>
                    <p className="faint">{creature.role}</p>
                    <Badge tone={AUTONOMY_INFO[creature.autonomy].tone}>{AUTONOMY_INFO[creature.autonomy].label}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <ul className="onb-tips">
              <li><b>Hatch a creature</b> from the sidebar: describe it and it researches your repos and writes its own notes.</li>
              <li><b>Autonomy</b> lives in the Dex: ask every time, auto-edit, or full auto inside a guard that never pushes or merges.</li>
              <li><b>Make it yours</b>: rename creatures in their creature.yaml and drop your own sprites into sprites/overrides/. The README has a section on a Pokémon-style setup.</li>
            </ul>
          </div>
        ))}

        {renderIf(step === Step.DONE, (
          <div className="onb-body">
            <h2>Shortcuts</h2>
            <div className="onb-list">
              <div className="onb-key"><span className="kbd">⌥ Space</span><span>Open the notch and talk to a creature (<span className="kbd">⇥</span> switches who)</span></div>
              <div className="onb-key"><span className="kbd">⌥ ⇧ Space</span><span>Minimize or bring back the route dock</span></div>
              <div className="onb-key"><span className="kbd">⌘ .</span><span>Stop the latest quest from the notch</span></div>
            </div>
            <label className="onb-check-row"><input type="checkbox" checked={openAtLogin} onChange={(event) => setOpenAtLogin(event.target.checked)} /><span>Launch Trainer HQ at login (dock and notch only)</span></label>
            <p className="muted">Everything here is also in Settings, and you can run this tour again from there.</p>
          </div>
        ))}

        <div className="onb-foot">
          {renderIf(step > Step.WELCOME, <button className="btn ghost" onClick={() => setStep((current) => current - 1)}>Back</button>)}
          <button className="btn ghost" onClick={() => { void window.hq.setOnboarded(true); onFinish(); }}>Skip</button>
          <button className="btn primary" disabled={step === Step.TOOLS && (prereqs === null || requiredMissing)} onClick={() => void next()}>
            {step === LAST_STEP ? 'Start training' : step === Step.TOOLS && requiredMissing ? 'Install the missing tools' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
