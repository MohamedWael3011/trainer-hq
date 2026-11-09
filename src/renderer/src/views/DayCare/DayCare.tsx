import { DaycareAction } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import { renderIf } from '../../lib/renderIf';
import { creatureName } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const DayCare = ({ state }: PropsType) => (
  <section className="care">
    <div className="care-intro">
      <Sprite state={state} id="egg" className="care-egg" />
      <p className="muted">After each chat, Day Care reads the transcript and suggests notes for that creature's brain. Nothing reaches the vault until you approve it.</p>
    </div>
    {state.daycare.map((note) => (
      <div key={note.id} className="care-note">
        <div className="care-src">
          <Sprite state={state} id={note.creatureId} className="care-sprite" />
          <span>{creatureName(state, note.creatureId)} · {note.source}</span>
        </div>
        <p className="selectable">{note.body}</p>
        <code className="care-dest">→ {note.target}</code>
        <div className="care-actions">
          <button className="btn primary sm" onClick={() => void window.hq.decideDaycare({ id: note.id, action: DaycareAction.APPROVE })}>Teach it</button>
          <button className="btn sm ghost" onClick={() => void window.hq.decideDaycare({ id: note.id, action: DaycareAction.DISMISS })}>Dismiss</button>
        </div>
      </div>
    ))}
    {renderIf(state.daycare.length === 0, <p className="faint">No suggestions waiting. They appear here after chats.</p>)}
  </section>
);

export default DayCare;
