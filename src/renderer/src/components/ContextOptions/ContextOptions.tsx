import { CONTEXT_OPTIONS } from '@shared/constants';
import type { CreatureType } from '@shared/types';
import './styles.css';

type PropsType = {
  creature: CreatureType;
};

const ContextOptions = ({ creature }: PropsType) => (
  <div className="dex-block">
    <div className="eyebrow">Loaded into every session</div>
    <div className="ctxopt">
      {CONTEXT_OPTIONS.map((option) => (
        <button
          key={option.id}
          className="dex-auto-opt"
          aria-pressed={creature[option.id]}
          onClick={() => void window.hq.setCreatureContext({ creatureId: creature.id, option: option.id, enabled: !creature[option.id] })}
        >
          <b>{option.label} · {creature[option.id] ? 'On' : 'Off'}</b>
          <span>{option.desc}</span>
          <code>{option.saves}</code>
        </button>
      ))}
    </div>
    <p className="muted ctxopt-note">Each of these is resent with every step of a chat. Turn off what this creature never uses. A message that starts with / still loads skills and commands for that turn.</p>
  </div>
);

export default ContextOptions;
