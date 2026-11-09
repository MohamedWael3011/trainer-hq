import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Autonomy, DEFAULT_DOCK_SIZE, DOCK_MINIMIZED_KEY, QuestStatus, Surface } from '@shared/constants';
import type { AppStateType, DockSizeType, QuestType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import RouteCanvas from '../../components/RouteCanvas/RouteCanvas';
import { renderIf } from '../../lib/renderIf';
import { creatureName, isLive } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const MAX_WALKERS = 8;
const RECENT_MS = 90_000;
const SLEEPER_ID = 'dozer';

const bubbleFor = (state: AppStateType, creatureId: string): string | null => {
  const quests: QuestType[] = state.quests;
  const helping = quests.find((quest) => quest.creatureId === creatureId && quest.askedBy && isLive(quest));
  if (helping?.askedBy) return `On it for ${creatureName(state, helping.askedBy)}`;
  const asking = quests.find((quest) => quest.parentId && isLive(quest) && quests.some((parent) => parent.id === quest.parentId && parent.creatureId === creatureId && isLive(parent)));
  if (asking) return `Asking ${creatureName(state, asking.creatureId)}…`;
  const latest = quests.find((quest) => quest.creatureId === creatureId);
  if (!latest) return null;
  if (latest.status === QuestStatus.WAITING) return 'Needs you';
  const recent = latest.endedAt !== undefined && Date.now() - latest.endedAt < RECENT_MS;
  if (recent && latest.status === QuestStatus.DONE) return 'Done!';
  if (recent && latest.status === QuestStatus.FAILED) return 'Help';
  return null;
};

const readMinimized = (): boolean => {
  try {
    return localStorage.getItem(DOCK_MINIMIZED_KEY) === 'true';
  } catch {
    return false;
  }
};

const Dock = ({ state }: PropsType) => {
  const walkers = useMemo(() => state.creatures.slice(0, MAX_WALKERS), [state.creatures]);
  const live = state.quests.filter(isLive);
  const anyLive = live.length > 0;
  const [minimized, setMinimized] = useState(readMinimized);
  const [instant, setInstant] = useState(false);
  const dragRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const pendingRef = useRef<DockSizeType | null>(null);
  const frameRef = useRef(0);
  const setInteractive = useCallback((on: boolean) => {
    if (!on && dragRef.current) return;
    void window.hq.setInteractive(Surface.DOCK, on);
  }, []);

  const startResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight };
  }, []);

  const moveResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    pendingRef.current = {
      width: drag.width + (drag.x - event.screenX) * 2,
      height: drag.height + (drag.y - event.screenY),
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (pendingRef.current) void window.hq.resizeDock(pendingRef.current, false);
    });
  }, []);

  const endResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    if (pendingRef.current) void window.hq.resizeDock(pendingRef.current, true);
    pendingRef.current = null;
  }, []);

  const toggle = useCallback((isInstant: boolean) => {
    setInstant(isInstant);
    setMinimized((current) => !current);
    void window.hq.setInteractive(Surface.DOCK, false);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_MINIMIZED_KEY, String(minimized));
    } catch {
      return;
    }
  }, [minimized]);

  useEffect(() => window.hq.onDockToggle(() => toggle(true)), [toggle]);
  useEffect(() => window.hq.onDockExpand(() => {
    setInstant(true);
    setMinimized(false);
  }), []);

  const hideDock = useCallback(() => {
    void window.hq.setInteractive(Surface.DOCK, false);
    void window.hq.setDockHidden(true);
  }, []);

  const pillCreature = live[0]?.creatureId ?? walkers[0]?.id ?? SLEEPER_ID;

  return (
    <div className={`dock-stage${minimized ? ' dock-minimized' : ''}${instant ? ' dock-instant' : ''}`}>
      <button
        className="dock-pill"
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => setInteractive(false)}
        onClick={() => toggle(false)}
        title="Show route dock (⌥⇧Space)"
        tabIndex={minimized ? 0 : -1}
      >
        <Sprite state={state} id={pillCreature} className="dock-pill-sprite" />
        <span className="dock-pill-count">{anyLive ? `${live.length} running` : 'idle'}</span>
        {renderIf(state.approvals.length > 0, <span className="dock-pill-alert">{state.approvals.length}!</span>)}
      </button>
      <button className="dock-pill-close" onMouseEnter={() => setInteractive(true)} onMouseLeave={() => setInteractive(false)} onClick={hideDock} title="Hide dock (bring back with ⌥⇧Space)" aria-label="Hide route dock" tabIndex={minimized ? 0 : -1}>×</button>
      <div className="dock" onMouseEnter={() => setInteractive(true)} onMouseLeave={() => setInteractive(false)}>
        <button
          className="dock-grip"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={() => void window.hq.resizeDock(DEFAULT_DOCK_SIZE, true)}
          title="Drag to resize · double-click to reset"
          aria-label="Resize route dock"
          tabIndex={minimized ? -1 : 0}
        >
          <span className="dock-grip-dots" />
        </button>
        <div className="dock-controls">
          <button className="dock-ctrl" onClick={() => toggle(false)} title="Minimize (⌥⇧Space)" aria-label="Minimize route dock" tabIndex={minimized ? -1 : 0}>–</button>
          <button className="dock-ctrl" onClick={hideDock} title="Hide dock (bring back with ⌥⇧Space)" aria-label="Hide route dock" tabIndex={minimized ? -1 : 0}>×</button>
        </div>
        <div className="dock-route">
          <RouteCanvas />
          {walkers.map((creature, index) => {
            const bubble = bubbleFor(state, creature.id);
            return (
              <button
                key={creature.id}
                className={`walker lane-${index}`}
                title={`${creature.name} · ${creature.role}`}
                onClick={() => void window.hq.openDashboard(creature.id)}
              >
                <Sprite state={state} id={creature.id} className="walker-sprite" alt={creature.name} />
                {renderIf(creature.autonomy === Autonomy.FULL_AUTO, <span className="walker-auto">auto</span>)}
                {renderIf(!!bubble, <span className="walker-bubble">{bubble}</span>)}
              </button>
            );
          })}
          {renderIf(!anyLive, (
            <div className="sleeper">
              <Sprite state={state} id={SLEEPER_ID} className="sleeper-sprite" alt="Nothing running" />
              <span className="sleeper-z">z z</span>
            </div>
          ))}
          {renderIf(state.creatures.length === 0, (
            <button className="dock-empty" onClick={() => void window.hq.openDashboard()}>No creatures yet. Open Trainer HQ to hatch one.</button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dock;
