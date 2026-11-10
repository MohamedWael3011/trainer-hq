import { memo } from 'react';
import { EventKind } from '@shared/constants';
import type { AppStateType, QuestEventType, QuestType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import Badge from '../Badge/Badge';
import Markdown from '../Markdown/Markdown';
import HandoffCard from '../HandoffCard/HandoffCard';
import { renderIf } from '../../lib/renderIf';
import { STATUS_LABEL, STATUS_TONE, creatureName, duration, isLive, questUsageSummary } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  quest: QuestType;
};

const visibleEvents = (events: QuestEventType[]): QuestEventType[] => {
  const lastText = [...events].reverse().find((event) => event.kind === EventKind.TEXT)?.text.trim();
  return events.filter((event) => !(event.kind === EventKind.RESULT && event.text.trim() === lastText));
};

const ASK_PREFIX = 'ask ';

const QuestLog = ({ state, quest }: PropsType) => {
  const children = state.quests.filter((entry) => entry.parentId === quest.id).sort((a, b) => a.startedAt - b.startedAt);
  const usage = questUsageSummary(quest);
  let childIndex = 0;
  return (
  <div className="ql">
    {renderIf(!!quest.askedBy, <div className="ql-handoff">Asked by {creatureName(state, quest.askedBy ?? '')}</div>)}
    {visibleEvents(quest.events).map((event, index) => {
      if (event.kind === EventKind.USER) return <div key={index} className="ql-me selectable">{event.text}</div>;
      if (event.kind === EventKind.TOOL && event.text.startsWith(ASK_PREFIX)) {
        const child = children[childIndex];
        childIndex += 1;
        return child ? <HandoffCard key={index} state={state} quest={child} /> : <div key={index} className="ql-tool">{event.text}</div>;
      }
      if (event.kind === EventKind.TOOL) return <div key={index} className="ql-tool">{event.text}</div>;
      if (event.kind === EventKind.ERROR) return <div key={index} className="ql-error selectable">{event.text}</div>;
      if (event.kind === EventKind.SYSTEM) return null;
      return (
        <div key={index} className="ql-bot">
          <Sprite state={state} id={quest.creatureId} className="ql-avatar" />
          <div className="ql-bubble"><Markdown text={event.text} baseDir={quest.cwd} /></div>
        </div>
      );
    })}
    <div className="ql-meta">
      <Badge tone={STATUS_TONE[quest.status]} dot>{STATUS_LABEL[quest.status]}</Badge>
      <span className="faint">{duration(quest)}</span>
      {renderIf(!!usage, (
        <span className={`ql-usage${usage?.expensive ? ' ql-usage-warn' : ''}`} title={usage?.detail}>
          {usage?.label}
        </span>
      ))}
      {renderIf(isLive(quest), <button className="btn sm ghost danger" onClick={() => void window.hq.cancelQuest(quest.id)}>Stop</button>)}
    </div>
  </div>
  );
};

export default memo(QuestLog);
