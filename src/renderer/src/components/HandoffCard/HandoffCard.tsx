import { memo, useState } from 'react';
import { EventKind } from '@shared/constants';
import type { AppStateType, QuestType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import Badge from '../Badge/Badge';
import Markdown from '../Markdown/Markdown';
import { renderIf } from '../../lib/renderIf';
import { STATUS_LABEL, STATUS_TONE, creatureName, duration, isLive } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  quest: QuestType;
};

const HandoffCard = ({ state, quest }: PropsType) => {
  const [open, setOpen] = useState(true);
  const live = isLive(quest);
  const question = quest.events.find((event) => event.kind === EventKind.USER)?.text ?? quest.title;
  const answer = [...quest.events].reverse().find((event) => event.kind === EventKind.RESULT || event.kind === EventKind.TEXT)?.text;
  const steps = quest.events.filter((event) => event.kind === EventKind.TOOL).length;
  const name = creatureName(state, quest.creatureId);

  return (
    <div className={`handoff${live ? ' handoff-live' : ''}`}>
      <button className="handoff-head" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <Sprite state={state} id={quest.creatureId} className="handoff-sprite" />
        <span className="handoff-title">Asked <b>{name}</b></span>
        {renderIf(live, <span className="handoff-dots" aria-label="working"><i /><i /><i /></span>)}
        <span className="handoff-meta">{steps > 0 ? `${steps} steps · ` : ''}{duration(quest)}</span>
        <Badge tone={STATUS_TONE[quest.status]}>{STATUS_LABEL[quest.status]}</Badge>
      </button>
      <div className="handoff-body" data-open={open}>
        <div className="handoff-inner">
          <p className="handoff-question selectable">{question}</p>
          {renderIf(!!answer && !live, <div className="handoff-answer">{answer ? <Markdown text={answer} baseDir={quest.cwd} /> : null}</div>)}
          <button className="handoff-open" onClick={() => void window.hq.openDashboard(quest.creatureId)}>Open {name}'s chat</button>
        </div>
      </div>
    </div>
  );
};

export default memo(HandoffCard);
