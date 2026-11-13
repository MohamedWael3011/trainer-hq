import { useCallback, useState } from 'react';
import type { AppStateType, TerminalSessionType } from '@shared/types';
import Badge from '../Badge/Badge';
import { renderIf } from '../../lib/renderIf';
import { BadgeTone, formatTokens, timeAgo } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onOpen: (creatureId: string) => void;
};

const TerminalSessions = ({ state, onOpen }: PropsType) => {
  const [target, setTarget] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fallback = state.creatures[0]?.id ?? '';

  const adopt = useCallback(async (session: TerminalSessionType) => {
    const creatureId = target[session.sessionId] ?? fallback;
    if (!creatureId) return;
    setError(null);
    try {
      await window.hq.adoptSession({ sessionId: session.sessionId, creatureId });
      onOpen(creatureId);
    } catch (failure) {
      setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }, [target, fallback, onOpen]);

  return (
    <div className="panel tsessions">
      <div className="eyebrow">Terminal sessions · last 2 days</div>
      {renderIf(state.terminalSessions.length === 0, <p className="faint tsessions-empty">No large Claude Code sessions in your terminal right now.</p>)}
      {state.terminalSessions.map((session) => (
        <div key={session.sessionId} className="tsessions-row">
          <div className="tsessions-main">
            <span className="tsessions-title">{session.title}</span>
            <span className="tsessions-meta">
              {session.project} · {formatTokens(session.contextTokens)} tokens resent every step · {timeAgo(session.lastActiveAt)}
            </span>
          </div>
          <div className="tsessions-side">
            {renderIf(session.large, <Badge tone={BadgeTone.WAIT}>Large</Badge>)}
            {renderIf(session.cold, <Badge tone={BadgeTone.FAIL}>Cold</Badge>)}
            <select
              aria-label="Creature to adopt this session"
              value={target[session.sessionId] ?? fallback}
              onChange={(event) => setTarget((current) => ({ ...current, [session.sessionId]: event.target.value }))}
            >
              {state.creatures.map((creature) => <option key={creature.id} value={creature.id}>{creature.name}</option>)}
            </select>
            <button className="btn sm" disabled={!fallback} title="Start a creature thread in the same folder with a short recap, instead of resuming the whole conversation" onClick={() => void adopt(session)}>Adopt</button>
          </div>
        </div>
      ))}
      {renderIf(state.terminalSessions.some((session) => session.cold), <p className="faint tsessions-note">Cold: idle long enough that the prompt cache expired, so the next message re-bills the whole conversation.</p>)}
      {renderIf(!!error, <p className="tsessions-error selectable">{error}</p>)}
    </div>
  );
};

export default TerminalSessions;
