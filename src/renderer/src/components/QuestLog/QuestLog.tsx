import { memo } from 'react';
import { EventKind } from '@shared/constants';
import type { AppStateType, QuestEventType, QuestType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import Badge from '../Badge/Badge';
import Markdown from '../Markdown/Markdown';
import HandoffCard from '../HandoffCard/HandoffCard';
import LiveStatus from '../LiveStatus/LiveStatus';
import { useQuestLive } from '../../hooks/useQuestLive';
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
// Tool calls a helper agent makes are logged with this prefix (see engines/claude.ts).
const HELPER_PREFIX = '↳ ';

type ItemType = { kind: 'event'; event: QuestEventType; index: number } | { kind: 'helper'; steps: string[]; index: number };

// Runs of helper-agent steps fold into one row, so a busy helper doesn't bury the conversation.
const groupHelperSteps = (events: QuestEventType[]): ItemType[] => {
  const items: ItemType[] = [];
  events.forEach((event, index) => {
    const isStep = event.kind === EventKind.TOOL && event.text.startsWith(HELPER_PREFIX);
    const last = items[items.length - 1];
    if (isStep && last?.kind === 'helper') last.steps.push(event.text.slice(HELPER_PREFIX.length));
    else if (isStep) items.push({ kind: 'helper', steps: [event.text.slice(HELPER_PREFIX.length)], index });
    else items.push({ kind: 'event', event, index });
  });
  return items;
};

const HelperSteps = ({ steps }: { steps: string[] }) => (
  <details className="ql-helper">
    <summary className="ql-tool">
      <span className="ql-helper-count">Helper · {steps.length === 1 ? '1 step' : `${steps.length} steps`}</span>
      <span className="ql-helper-last">{steps[steps.length - 1]}</span>
    </summary>
    <div className="ql-helper-steps">
      {steps.map((step, index) => <div key={index} className="ql-helper-step">{step}</div>)}
    </div>
  </details>
);

const QuestLog = ({ state, quest }: PropsType) => {
  const children = state.quests.filter((entry) => entry.parentId === quest.id).sort((a, b) => a.startedAt - b.startedAt);
  const usage = questUsageSummary(quest);
  const running = isLive(quest);
  const live = useQuestLive(running ? quest.id : undefined);
  let childIndex = 0;
  return (
  <div className="ql">
    {renderIf(!!quest.askedBy, <div className="ql-handoff">Asked by {creatureName(state, quest.askedBy ?? '')}</div>)}
    {groupHelperSteps(visibleEvents(quest.events)).map((item) => {
      if (item.kind === 'helper') return <HelperSteps key={item.index} steps={item.steps} />;
      const { event, index } = item;
      if (event.kind === EventKind.USER) return <div key={index} className="ql-me selectable">{event.text}</div>;
      if (event.kind === EventKind.TOOL && event.text.startsWith(ASK_PREFIX)) {
        const child = children[childIndex];
        childIndex += 1;
        return child ? <HandoffCard key={index} state={state} quest={child} /> : <div key={index} className="ql-tool">{event.text}</div>;
      }
      if (event.kind === EventKind.TOOL) return <div key={index} className="ql-tool">{event.text}</div>;
      if (event.kind === EventKind.ERROR) return <div key={index} className="ql-error selectable">{event.text}</div>;
      if (event.kind === EventKind.SYSTEM) return <div key={index} className="ql-tool">{event.text}</div>;
      return (
        <div key={index} className="ql-bot">
          <Sprite state={state} id={quest.creatureId} className="ql-avatar" />
          <div className="ql-bubble"><Markdown text={event.text} baseDir={quest.cwd} /></div>
        </div>
      );
    })}
    {renderIf(running && !!live?.draft, (
      <div className="ql-bot ql-draft">
        <Sprite state={state} id={quest.creatureId} className="ql-avatar" />
        <div className="ql-bubble"><Markdown text={live?.draft ?? ''} baseDir={quest.cwd} /></div>
      </div>
    ))}
    <div className="ql-meta">
      {running ? <LiveStatus quest={quest} live={live} /> : (
        <>
          <Badge tone={STATUS_TONE[quest.status]} dot>{STATUS_LABEL[quest.status]}</Badge>
          <span className="faint">{duration(quest)}</span>
        </>
      )}
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
