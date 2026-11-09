import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { QuestStatus, View, type ViewType } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Party from '../../views/Party/Party';
import Quests from '../../views/Quests/Quests';
import Dex from '../../views/Dex/Dex';
import DayCare from '../../views/DayCare/DayCare';
import Trainer from '../../views/Trainer/Trainer';
import HatchSheet from '../../views/HatchSheet/HatchSheet';
import ProfileSheet from '../../views/ProfileSheet/ProfileSheet';
import Lab from '../../views/Lab/Lab';
import Settings from '../../views/Settings/Settings';
import Onboarding from '../../views/Onboarding/Onboarding';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const NAV: { view: ViewType; label: string }[] = [
  { view: View.PARTY, label: 'Party' },
  { view: View.QUESTS, label: 'Quests' },
  { view: View.DEX, label: 'Dex' },
  { view: View.DAYCARE, label: 'Day Care' },
  { view: View.LAB, label: 'Lab' },
  { view: View.TRAINER, label: 'Trainer' },
  { view: View.SETTINGS, label: 'Settings' },
];

const AUDITOR_SKILL = 'figma-audit';

const DRAG_TYPE = 'application/x-thq-creature';
const KEY_UP = 'ArrowUp';
const KEY_DOWN = 'ArrowDown';

const Dashboard = ({ state }: PropsType) => {
  const [view, setView] = useState<ViewType>(View.PARTY);
  const [selected, setSelected] = useState<string>(state.creatures[0]?.id ?? '');
  const [hatching, setHatching] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [touring, setTouring] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const moveCreature = useCallback((id: string, targetIndex: number) => {
    const ids = state.creatures.map((creature) => creature.id).filter((entry) => entry !== id);
    const clamped = Math.max(0, Math.min(ids.length, targetIndex));
    ids.splice(clamped, 0, id);
    void window.hq.reorderCreatures(ids);
  }, [state.creatures]);

  const onRosterKey = useCallback((event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    if (!event.altKey) return;
    if (event.key === KEY_UP) {
      event.preventDefault();
      moveCreature(id, index - 1);
    }
    if (event.key === KEY_DOWN) {
      event.preventDefault();
      moveCreature(id, index + 1);
    }
  }, [moveCreature]);

  const endDrag = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  useEffect(() => window.hq.onOpenView((next) => {
    if ((Object.values(View) as string[]).includes(next)) setView(next as ViewType);
  }), []);

  useEffect(() => window.hq.onFocusCreature((id) => {
    setSelected(id);
    setView(View.PARTY);
  }), []);

  useEffect(() => {
    if (!state.creatures.some((creature) => creature.id === selected) && state.creatures[0]) setSelected(state.creatures[0].id);
  }, [state.creatures, selected]);

  const auditor = state.creatures.find((creature) => creature.skills.includes(AUDITOR_SKILL));

  const counts: Partial<Record<ViewType, number>> = {
    [View.QUESTS]: state.approvals.length + state.quests.filter((quest) => quest.status === QuestStatus.RUNNING).length,
    [View.DAYCARE]: state.daycare.length,
  };

  const statusOf = (id: string): string => {
    const latest = state.quests.find((quest) => quest.creatureId === id);
    if (latest?.status === QuestStatus.WAITING) return 'wait';
    if (latest?.status === QuestStatus.RUNNING) return 'run';
    return 'idle';
  };

  return (
    <div className="dash">
      <header className="dash-bar">
        <span className="dash-title">Trainer HQ</span>
        <div className="dash-profile-bar">
          <div className="seg dash-profiles" role="group" aria-label="Profile">
            {state.profiles.map((profile) => (
              <button key={profile.id} aria-pressed={profile.id === state.profile.id} onClick={() => void window.hq.switchProfile(profile.id)}>
                {profile.name}
              </button>
            ))}
          </div>
          <button className="btn sm ghost dash-add-profile" onClick={() => setAddingProfile(true)} title="New profile" aria-label="New profile">+ Profile</button>
        </div>
      </header>
      <div className="dash-body">
        <aside className="dash-side">
          <nav className="dash-nav" aria-label="Sections">
            {NAV.filter((item) => item.view !== View.LAB || state.labEnabled).map((item) => (
              <button key={item.view} aria-current={item.view === view ? 'page' : undefined} onClick={() => setView(item.view)}>
                {item.label}
                {renderIf(!!counts[item.view], <span className="dash-count">{counts[item.view]}</span>)}
              </button>
            ))}
          </nav>
          <div className="dash-roster-wrap">
            <div className="eyebrow dash-label">Party · {state.creatures.length}</div>
            <div className="dash-roster">
              {state.creatures.map((creature, index) => (
                <button
                  key={creature.id}
                  className={`dash-mon${dragId === creature.id ? ' dash-mon-dragging' : ''}${overId === creature.id && dragId !== creature.id ? ' dash-mon-over' : ''}`}
                  aria-pressed={creature.id === selected}
                  title="Drag to reorder · ⌥↑ / ⌥↓"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, creature.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragId(creature.id);
                  }}
                  onDragOver={(event) => {
                    if (!dragId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setOverId(creature.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragId && dragId !== creature.id) moveCreature(dragId, index);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => onRosterKey(event, creature.id, index)}
                  onClick={() => {
                    setSelected(creature.id);
                    if (view !== View.DEX) setView(View.PARTY);
                  }}
                >
                  <Sprite state={state} id={creature.id} className="dash-mon-sprite" />
                  <span className="dash-mon-text">
                    <span className="dash-mon-name">{creature.name}</span>
                    <span className="dash-mon-role">{creature.role}</span>
                  </span>
                  <span className={`dash-mon-status dash-mon-${statusOf(creature.id)}`} />
                </button>
              ))}
            </div>
          </div>
          <button className="dash-hatch" onClick={() => setHatching(true)}>
            <Sprite state={state} id="egg" className="dash-hatch-sprite" />
            Hatch a creature
          </button>
          <button className="btn ghost sm dash-vault" onClick={() => void window.hq.openPath()}>Open vault</button>
        </aside>
        <main className="dash-main">
          {renderIf(!!state.auth && !state.auth.loggedIn, (
            <div className="dash-auth">
              <div>
                <b>Claude isn't signed in for {state.profile.name}.</b>
                <p>Creatures using the Claude engine can't run until you sign in. Sign in opens Terminal with <code>claude auth login</code>.</p>
              </div>
              <div className="dash-auth-actions">
                <button className="btn primary sm" onClick={() => void window.hq.openLogin()}>Sign in</button>
                <button className="btn sm" onClick={() => void window.hq.refreshAuth()}>Check again</button>
              </div>
            </div>
          ))}
          {renderIf(state.errors.length > 0, <div className="dash-errors selectable">{state.errors.join('\n')}</div>)}
          {renderIf(view === View.PARTY, <Party state={state} creatureId={selected} />)}
          {renderIf(view === View.QUESTS, <Quests state={state} onOpen={(id) => { setSelected(id); setView(View.PARTY); }} />)}
          {renderIf(view === View.DEX, <Dex state={state} creatureId={selected} />)}
          {renderIf(view === View.DAYCARE, <DayCare state={state} />)}
          {renderIf(view === View.LAB, (
            <Lab
              auditorId={auditor?.id}
              auditorName={auditor?.name}
              onAudit={(creatureId, text) => {
                void window.hq.chat({ creatureId, text });
                setSelected(creatureId);
                setView(View.PARTY);
              }}
            />
          ))}
          {renderIf(view === View.TRAINER, <Trainer state={state} />)}
          {renderIf(view === View.SETTINGS, <Settings state={state} onRestartOnboarding={() => { void window.hq.setOnboarded(false); setTouring(true); }} />)}
        </main>
      </div>
      {renderIf(hatching, <HatchSheet state={state} onClose={() => setHatching(false)} />)}
      {renderIf(addingProfile, <ProfileSheet onClose={() => setAddingProfile(false)} />)}
      {renderIf(!state.ui.onboarded || touring, <Onboarding state={state} onFinish={() => setTouring(false)} />)}
    </div>
  );
};

export default Dashboard;
