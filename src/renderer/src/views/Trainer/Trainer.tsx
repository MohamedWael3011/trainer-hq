import { useEffect, useState } from 'react';
import type { AppStateType } from '@shared/types';
import Spark from '../../components/Spark/Spark';
import Sprite from '../../components/Sprite/Sprite';
import { renderIf } from '../../lib/renderIf';
import { percent } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const Trainer = ({ state }: PropsType) => {
  const lead = state.creatures[0]?.id ?? 'egg';
  const [openAtLogin, setOpenAtLogin] = useState(false);
  useEffect(() => {
    void window.hq.getOpenAtLogin().then(setOpenAtLogin);
  }, []);
  const toggleLogin = (enabled: boolean) => {
    setOpenAtLogin(enabled);
    void window.hq.setOpenAtLogin(enabled);
  };
  return (
    <section className="trainer">
      <div className="trainer-card">
        <div className="trainer-top">
          <div>
            <div className="trainer-label">Trainer card</div>
            <h2>{state.profile.name}</h2>
          </div>
          <Sprite state={state} id={lead} className="trainer-sprite" />
        </div>
        <div className="trainer-kv"><span>Vault</span><span>{state.profile.vault}</span></div>
        <div className="trainer-kv"><span>Party</span><span>{state.creatures.length} creatures</span></div>
        <div className="trainer-kv"><span>Repos</span><span>{state.repos.join(' · ') || 'none yet'}</span></div>
        <div className="trainer-kv"><span>Engines</span><span>{state.engines.join(' · ')}</span></div>
        <div className="trainer-kv">
          <span>Claude account</span>
          <span>
            {renderIf(!state.auth, 'checking…')}
            {renderIf(!!state.auth?.loggedIn, `${state.auth?.email ?? 'signed in'}${state.auth?.plan ? ` · ${state.auth.plan} plan` : ''}`)}
            {renderIf(!!state.auth && !state.auth.loggedIn, <button className="trainer-signin" onClick={() => void window.hq.openLogin()}>Not signed in · Sign in</button>)}
          </span>
        </div>
        {renderIf(!!state.auth?.expiresAt, <div className="trainer-kv"><span>Login expires</span><span>{new Date(state.auth?.expiresAt ?? 0).toLocaleDateString()}</span></div>)}
        <label className="trainer-login">
          <input type="checkbox" checked={openAtLogin} onChange={(event) => toggleLogin(event.target.checked)} />
          <span>Launch at login (dock and notch only, no window)</span>
        </label>
        <label className="trainer-login">
          <input type="checkbox" checked={!state.ui.dockHidden} onChange={(event) => void window.hq.setDockHidden(!event.target.checked)} />
          <span>Show route dock (⌥⇧Space)</span>
        </label>
      </div>
      <div className="trainer-stats">
        <div className="panel"><div className="eyebrow">Quests done</div><div className="trainer-big">{state.stats.questsDone}</div></div>
        <div className="panel"><div className="eyebrow">Notes learned</div><div className="trainer-big">{state.stats.notesLearned}</div></div>
        <div className="panel trainer-wide">
          <div className="eyebrow">Plan usage</div>
          {renderIf(!state.usage, <p className="faint trainer-usage-empty">Shows up after your first Claude quest.</p>)}
          {renderIf(!!state.usage, (
            <div className="trainer-usage">
              <label className="trainer-meter"><span>5-hour window</span><meter min={0} max={1} low={0.6} high={0.85} optimum={0} value={state.usage?.fiveHour ?? 0} /><b>{percent(state.usage?.fiveHour)}</b></label>
              <label className="trainer-meter"><span>7-day window</span><meter min={0} max={1} low={0.6} high={0.85} optimum={0} value={state.usage?.sevenDay ?? 0} /><b>{percent(state.usage?.sevenDay)}</b></label>
              {renderIf(!!state.usage?.resetsAt, <span className="faint">Resets {new Date(state.usage?.resetsAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>)}
            </div>
          ))}
        </div>
        <div className="panel trainer-wide"><div className="eyebrow">Quests · last 14 days</div><Spark values={state.stats.sessionsByDay} /></div>
      </div>
    </section>
  );
};

export default Trainer;
