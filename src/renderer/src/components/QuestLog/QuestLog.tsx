import { memo } from 'react';
import { EventKind } from '@shared/constants';
import type { AppStateType, QuestEventType, QuestType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import Badge from '../Badge/Badge';
import Markdown from '../Markdown/Markdown';
import HandoffCard from '../HandoffCard/HandoffCard';
import LiveStatus from '../LiveStatus/LiveStatus';
import OutputFiles from '../OutputFiles/OutputFiles';
import { useQuestLive } from '../../hooks/useQuestLive';
import { firstSentence, parseCommand, useCommands } from '../../hooks/useCommands';
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
// How a skill run is logged (see summarizeToolInput in approvals.ts).
const SKILL_EVENT = /^Skill (\S+)\s*([\s\S]*)$/;
// How a background command is logged (see summarizeToolInput in approvals.ts).
const BACKGROUND_PREFIX = 'Bash (background) ';
// Tool calls a helper agent makes are logged with this prefix (see engines/claude.ts).
const HELPER_PREFIX = '↳ ';
// How starting a helper is logged (see summarizeToolInput in approvals.ts).
const HELPER_START = 'Helper agent: ';

type ItemType = { kind: 'event'; event: QuestEventType; index: number } | { kind: 'helper'; task?: string; steps: string[]; index: number };

// Runs of helper-agent steps fold into one row, so a busy helper doesn't bury the conversation.
const groupHelperSteps = (events: QuestEventType[]): ItemType[] => {
  const items: ItemType[] = [];
  events.forEach((event, index) => {
    const isStep = event.kind === EventKind.TOOL && event.text.startsWith(HELPER_PREFIX);
    const last = items[items.length - 1];
    const step = event.text.slice(HELPER_PREFIX.length);
    if (isStep && last?.kind === 'helper') last.steps.push(step);
    else if (isStep && last?.kind === 'event' && last.event.kind === EventKind.TOOL && last.event.text.startsWith(HELPER_START)) {
      // The helper's steps belong to the line that started it: show them as one row.
      items[items.length - 1] = { kind: 'helper', task: last.event.text.slice(HELPER_START.length), steps: [step], index: last.index };
    } else if (isStep) items.push({ kind: 'helper', steps: [step], index });
    else items.push({ kind: 'event', event, index });
  });
  return items;
};

const HelperSteps = ({ task, steps }: { task?: string; steps: string[] }) => (
  <details className="ql-helper">
    <summary className="ql-tool">
      <span className="ql-helper-count">{task ? `Helper: ${task}` : 'Helper'} · {steps.length === 1 ? '1 step' : `${steps.length} steps`}</span>
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
  const commands = useCommands(quest.creatureId, state.quests.filter((entry) => entry.creatureId === quest.creatureId && !isLive(entry)).length);
  const describe = (name: string): string => commands.find((entry) => entry.name === name)?.description ?? '';
  let childIndex = 0;
  return (
  <div className="ql">
    {renderIf(!!quest.askedBy, <div className="ql-handoff">Asked by {creatureName(state, quest.askedBy ?? '')}</div>)}
    {groupHelperSteps(visibleEvents(quest.events)).map((item) => {
      if (item.kind === 'helper') return <HelperSteps key={item.index} task={item.task} steps={item.steps} />;
      const { event, index } = item;
      if (event.kind === EventKind.USER) {
        const command = parseCommand(event.text);
        if (!command) return <div key={index} className="ql-me selectable">{event.text}</div>;
        return (
          <div key={index} className="ql-me ql-command selectable" title={describe(command.name) || undefined}>
            <span><b>/{command.name}</b>{command.args ? ` ${command.args}` : ''}</span>
            {renderIf(!!describe(command.name), <span className="ql-command-desc">{firstSentence(describe(command.name))}</span>)}
          </div>
        );
      }
      // Files show together in one card after the reply's steps.
      if (event.kind === EventKind.OUTPUT) return null;
      if (event.kind === EventKind.TOOL && event.text.startsWith(BACKGROUND_PREFIX)) {
        return (
          <div key={index} className="ql-bg">
            <span className="ql-bg-title">Running in the background</span>
            <span className="ql-bg-cmd selectable">{event.text.slice(BACKGROUND_PREFIX.length)}</span>
            <span className="ql-bg-note">{creatureName(state, quest.creatureId)} gets the result when it finishes. Files it makes show up below.</span>
          </div>
        );
      }
      const skill = event.kind === EventKind.TOOL ? event.text.match(SKILL_EVENT) : null;
      if (skill) {
        return (
          <div key={index} className="ql-skill" title={describe(skill[1])}>
            <span className="ql-skill-name">Skill · {skill[1]}</span>
            <span className="ql-skill-desc">{firstSentence(describe(skill[1])) || skill[2] || 'Loaded its instructions and is following them.'}</span>
          </div>
        );
      }
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
    <OutputFiles paths={quest.events.filter((event) => event.kind === EventKind.OUTPUT).map((event) => event.text)} />
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
