import { useCallback, useState } from 'react';
import { Autonomy, QuestStatus, type AutonomyType } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import QuestLog from '../../components/QuestLog/QuestLog';
import { renderIf } from '../../lib/renderIf';
import { AUTONOMY_INFO, isLive } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onClose: () => void;
};

const AUTONOMY_ORDER: AutonomyType[] = [Autonomy.ASK, Autonomy.AUTO_EDIT, Autonomy.FULL_AUTO];

const HatchSheet = ({ state, onClose }: PropsType) => {
  const [prompt, setPrompt] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [engine, setEngine] = useState(state.engines[0] ?? 'claude');
  const [autonomy, setAutonomy] = useState<AutonomyType>(Autonomy.AUTO_EDIT);
  const [questId, setQuestId] = useState<string | null>(null);
  const quest = questId ? state.quests.find((entry) => entry.id === questId) : undefined;
  const hatching = !!quest && isLive(quest);

  const toggleRepo = useCallback((name: string) => {
    setRepos((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));
  }, []);

  const start = useCallback(async () => {
    if (!prompt.trim()) return;
    setQuestId(await window.hq.hatch({ prompt: prompt.trim(), repos, engine, autonomy }));
  }, [prompt, repos, engine, autonomy]);

  return (
    <div className="sheet-wrap" onClick={(event) => { if (event.target === event.currentTarget && !hatching) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="hatch-title">
        <div className="sheet-head">
          <Sprite state={state} id="egg" className={`sheet-egg${hatching ? ' sheet-egg-wobble' : ''}`} />
          <div>
            <h2 id="hatch-title">Hatch a creature</h2>
            <p className="muted">Describe what it should do. It researches its own notes and writes its folder in your vault.</p>
          </div>
        </div>
        {renderIf(!quest, (
          <div className="sheet-form">
            <label className="sheet-field">
              <span>What should it do?</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A release-notes writer that reads merged PRs every Thursday and drafts plain-language notes for PMs." rows={5} autoFocus />
            </label>
            <div className="sheet-field">
              <span>Repos it can read</span>
              <div className="sheet-chips">
                {state.repos.map((name) => (
                  <button key={name} type="button" className="sheet-chip" aria-pressed={repos.includes(name)} onClick={() => toggleRepo(name)}>{name}</button>
                ))}
                {renderIf(state.repos.length === 0, <span className="faint">Add repos to profile.yaml to pick them here.</span>)}
              </div>
            </div>
            <div className="sheet-row">
              <label className="sheet-field">
                <span>Engine</span>
                <select value={engine} onChange={(event) => setEngine(event.target.value)}>
                  {state.engines.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="sheet-field">
                <span>Autonomy</span>
                <select value={autonomy} onChange={(event) => setAutonomy(event.target.value as AutonomyType)}>
                  {AUTONOMY_ORDER.map((level) => <option key={level} value={level}>{AUTONOMY_INFO[level].label}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
        {renderIf(!!quest, quest ? <div className="sheet-progress"><QuestLog state={state} quest={quest} /></div> : null)}
        <div className="sheet-foot">
          {renderIf(!quest, <button className="btn ghost" onClick={onClose}>Cancel</button>)}
          {renderIf(!quest, <button className="btn primary" disabled={!prompt.trim()} onClick={() => void start()}>Hatch</button>)}
          {renderIf(!!quest && !hatching, <button className="btn primary" onClick={onClose}>{quest?.status === QuestStatus.DONE ? 'Meet your creature' : 'Close'}</button>)}
        </div>
      </div>
    </div>
  );
};

export default HatchSheet;
