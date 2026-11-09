import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NOTCH_TARGET_KEY, Surface } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import ApprovalCard from '../../components/ApprovalCard/ApprovalCard';
import { renderIf } from '../../lib/renderIf';
import { STATUS_LABEL, STATUS_TONE, creatureName, isLive, parseMention, percent } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const RECENT_COUNT = 3;
const KEY_ENTER = 'Enter';
const KEY_ESCAPE = 'Escape';
const KEY_STOP = '.';
const KEY_TAB = 'Tab';

const readTarget = (): string => {
  try {
    return localStorage.getItem(NOTCH_TARGET_KEY) ?? '';
  } catch {
    return '';
  }
};

const Notch = ({ state }: PropsType) => {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const [hardware, setHardware] = useState(false);
  const live = state.quests.filter(isLive);
  const recent = state.quests.slice(0, RECENT_COUNT);
  const approval = state.approvals[0];
  const [target, setTarget] = useState(readTarget);
  const fallbackCreature = state.quests[0]?.creatureId ?? state.creatures[0]?.id ?? '';
  const defaultCreature = state.creatures.some((creature) => creature.id === target) ? target : fallbackCreature;

  const pickTarget = useCallback((id: string) => {
    setTarget(id);
    try {
      localStorage.setItem(NOTCH_TARGET_KEY, id);
    } catch {
      return;
    }
  }, []);

  const cycleTarget = useCallback((step: number) => {
    const ids = state.creatures.map((creature) => creature.id);
    if (ids.length === 0) return;
    const current = Math.max(0, ids.indexOf(defaultCreature));
    pickTarget(ids[(current + step + ids.length) % ids.length]);
  }, [state.creatures, defaultCreature, pickTarget]);
  const peekCreature = live[0]?.creatureId ?? defaultCreature;

  useEffect(() => {
    void window.hq.getNotchMetrics().then((metrics) => {
      const root = document.documentElement.style;
      root.setProperty('--bar-h', `${metrics.barHeight}px`);
      root.setProperty('--pill-w', `${metrics.pillWidth}px`);
      root.setProperty('--notch-w', `${metrics.notchWidth}px`);
      root.setProperty('--pill-inset', `${(metrics.panelWidth - metrics.pillWidth) / 2}px`);
      setHardware(metrics.hasNotch);
    });
  }, []);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => {
      document.documentElement.style.setProperty('--open-h', `${Math.min(window.innerHeight, Math.ceil(inner.offsetTop + inner.offsetHeight + 14))}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const show = useCallback((isInstant: boolean) => {
    openRef.current = true;
    setInstant(isInstant);
    setOpen(true);
    void window.hq.setInteractive(Surface.NOTCH, true);
    if (isInstant) requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const hide = useCallback((isInstant: boolean) => {
    openRef.current = false;
    inputRef.current?.blur();
    setInstant(isInstant);
    setOpen(false);
    void window.hq.setInteractive(Surface.NOTCH, false);
  }, []);

  useEffect(() => window.hq.onNotchToggle(({ instant: isInstant }) => {
    if (openRef.current) hide(isInstant);
    else show(isInstant);
  }), [hide, show]);

  const submit = useCallback(() => {
    const value = draft.trim();
    if (!value || !defaultCreature) return;
    const { creatureId, text } = parseMention(value, state, defaultCreature);
    void window.hq.chat({ creatureId, text });
    setDraft('');
  }, [draft, defaultCreature, state]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === KEY_ESCAPE) hide(true);
    if (event.key === KEY_STOP && event.metaKey && live[0]) void window.hq.cancelQuest(live[0].id);
  }, [hide, live]);

  return (
    <div className="notch-stage" onKeyDown={onKeyDown}>
      <div
        className={`notch${open ? ' notch-open' : ''}${instant ? ' notch-instant' : ''}${hardware ? ' notch-hardware' : ''}`}
        onMouseEnter={() => { if (!open) show(false); }}
        onMouseLeave={() => { if (open && !draft) hide(false); }}
      >
        <div className="notch-peek">
          <span className="notch-wing notch-wing-left">
            {renderIf(!!peekCreature, <Sprite state={state} id={peekCreature} className="notch-peek-sprite" />)}
          </span>
          <span className="notch-gap" />
          <span className="notch-wing notch-wing-right">
            <span className="notch-live"><i />{live.length}{state.approvals.length > 0 ? ` · ${state.approvals.length}!` : ''}</span>
          </span>
        </div>
        <div className="notch-drop">
          <div className="notch-inner" ref={innerRef}>
          {renderIf(!approval, (
          <div className="notch-party" role="radiogroup" aria-label="Talk to">
              {state.creatures.map((creature) => (
                <button
                  key={creature.id}
                  className="notch-pick"
                  role="radio"
                  aria-checked={creature.id === defaultCreature}
                  title={`${creature.name} · ${creature.role}`}
                  onClick={() => {
                    pickTarget(creature.id);
                    inputRef.current?.focus();
                  }}
                >
                  <Sprite state={state} id={creature.id} className="notch-pick-sprite" />
                </button>
              ))}
              <span className="notch-pick-name">{creatureName(state, defaultCreature)}</span>
            </div>
          ))}
          <div className="notch-ask">
            <span className="notch-at">@</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === KEY_ENTER) submit();
                if (event.key === KEY_TAB) {
                  event.preventDefault();
                  cycleTarget(event.shiftKey ? -1 : 1);
                }
              }}
              placeholder={`${defaultCreature ? creatureName(state, defaultCreature).toLowerCase() : 'creature'} what should I do?`}
              spellCheck={false}
            />
            <span className="kbd notch-kbd">⏎</span>
          </div>
          {renderIf(!!approval, approval ? (
            <div className="notch-approval">
              {renderIf(state.approvals.length > 1, <span className="notch-approval-count">1 of {state.approvals.length} waiting</span>)}
              <ApprovalCard state={state} approval={approval} compact />
            </div>
          ) : null)}
          {renderIf(!approval, (
            <div className="notch-rows">
              {recent.map((quest) => (
                <button key={quest.id} className="notch-row" onClick={() => void window.hq.openDashboard(quest.creatureId)}>
                  <Sprite state={state} id={quest.creatureId} className="notch-row-sprite" />
                  <span className="notch-row-text"><b>{creatureName(state, quest.creatureId)}</b> · {quest.title}</span>
                  <Badge tone={STATUS_TONE[quest.status]}>{STATUS_LABEL[quest.status]}</Badge>
                </button>
              ))}
              {renderIf(recent.length === 0, <p className="notch-empty">No quests yet. Type @name and a task.</p>)}
            </div>
          ))}
          <div className="notch-foot">
            <span><span className="kbd notch-kbd">⌥ Space</span> toggle</span>
            <span><span className="kbd notch-kbd">⇥</span> switch</span>
            <span><span className="kbd notch-kbd">⌘ .</span> stop latest</span>
            {renderIf(!!state.usage, <span>plan {percent(state.usage?.fiveHour)}</span>)}
            <span className="notch-links">
              {renderIf(state.ui.dockHidden, <button className="notch-link" onClick={() => void window.hq.setDockHidden(false)}>Show dock</button>)}
              <button className="notch-link" onClick={() => void window.hq.openDashboard()}>Dashboard</button>
            </span>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Notch;
