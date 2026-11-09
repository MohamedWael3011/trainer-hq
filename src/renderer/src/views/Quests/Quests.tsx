import { useMemo, useState } from 'react';
import { EventKind, QuestStatus, type QuestStatusType } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import ApprovalCard from '../../components/ApprovalCard/ApprovalCard';
import { renderIf } from '../../lib/renderIf';
import { STATUS_LABEL, STATUS_TONE, creatureName, duration, isLive, timeAgo } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  onOpen: (creatureId: string) => void;
};

const Filter = {
  ALL: 'all',
  NEEDS_YOU: 'needs-you',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
} as const;
type FilterType = (typeof Filter)[keyof typeof Filter];

const FILTERS: { id: FilterType; label: string; statuses: QuestStatusType[] }[] = [
  { id: Filter.ALL, label: 'All', statuses: Object.values(QuestStatus) },
  { id: Filter.NEEDS_YOU, label: 'Needs you', statuses: [QuestStatus.WAITING, QuestStatus.PAUSED] },
  { id: Filter.RUNNING, label: 'Running', statuses: [QuestStatus.RUNNING] },
  { id: Filter.DONE, label: 'Done', statuses: [QuestStatus.DONE] },
  { id: Filter.FAILED, label: 'Failed', statuses: [QuestStatus.FAILED, QuestStatus.CANCELLED] },
];

const Quests = ({ state, onOpen }: PropsType) => {
  const [filter, setFilter] = useState<FilterType>(Filter.ALL);
  const statuses = FILTERS.find((entry) => entry.id === filter)?.statuses ?? [];
  const quests = useMemo(() => state.quests.filter((quest) => statuses.includes(quest.status)), [state.quests, statuses]);

  return (
    <section className="quests">
      <div className="quests-top">
        <div className="seg" role="group" aria-label="Filter quests">
          {FILTERS.map((entry) => (
            <button key={entry.id} aria-pressed={entry.id === filter} onClick={() => setFilter(entry.id)}>{entry.label}</button>
          ))}
        </div>
      </div>
      {state.approvals.map((approval) => <ApprovalCard key={approval.id} state={state} approval={approval} />)}
      <div className="quests-list">
        {quests.map((quest) => {
          const lastError = [...quest.events].reverse().find((event) => event.kind === EventKind.ERROR);
          return (
            <div key={quest.id} className="quest-row">
              <Sprite state={state} id={quest.creatureId} className="quest-sprite" />
              <button className="quest-main" onClick={() => onOpen(quest.creatureId)}>
                <span className="quest-title">{quest.title || 'Untitled quest'}</span>
                <span className="quest-meta">{creatureName(state, quest.creatureId)} · {quest.askedBy ? `asked by ${creatureName(state, quest.askedBy)}` : quest.kind} · {timeAgo(quest.startedAt)} · {duration(quest)}</span>
                {renderIf(!!lastError, <span className="quest-error">{lastError?.text}</span>)}
              </button>
              <div className="quest-side">
                <Badge tone={STATUS_TONE[quest.status]} dot>{STATUS_LABEL[quest.status]}</Badge>
                {renderIf(isLive(quest), <button className="btn sm ghost danger" onClick={() => void window.hq.cancelQuest(quest.id)}>Stop</button>)}
              </div>
            </div>
          );
        })}
        {renderIf(quests.length === 0, <p className="muted quests-empty">Nothing here yet.</p>)}
      </div>
    </section>
  );
};

export default Quests;
