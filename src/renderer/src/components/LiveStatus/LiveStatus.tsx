import { memo, useEffect, useState } from 'react';
import { QuestStatus } from '@shared/constants';
import type { QuestLiveType, QuestType } from '@shared/types';
import './styles.css';

type PropsType = {
  quest: QuestType;
  live?: QuestLiveType;
};

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const FRAME_MS = 120;
const TIP_MS = 12_000;
const VERBS = ['Incubating', 'Training', 'Evolving', 'Foraging', 'Scouting', 'Hatching', 'Leveling up', 'Charging up', 'Tinkering', 'Pondering', 'Brewing', 'Tracking'];
const TIPS = [
  'Send a message while it works to steer it mid-task.',
  'Done with a topic? Clear the chat so the next one starts small.',
  'Compact keeps the context but makes every next step cheaper.',
  'Lower the Effort for quick edits: less thinking, less plan use.',
  'Point at exact files or lines to skip the searching.',
  'One thread per task keeps each chat small and cheap.',
  'Every step resends the whole chat, so long chats cost more per step.',
];

const pick = <T,>(list: readonly T[], seed: string): T => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return list[Math.abs(hash) % list.length];
};

const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

const tokens = (count: number): string => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count));

const phaseText = (live?: QuestLiveType): string => {
  if (!live || live.phase === 'starting') return 'starting';
  if (live.phase === 'tool') return live.tool ? `running ${live.tool}` : 'running a tool';
  return live.phase;
};

// The terminal-style status line under a running reply: spinner, verb, time, tokens and a tip.
const LiveStatus = ({ quest, live }: PropsType) => {
  const [now, setNow] = useState(Date.now());
  const [frame, setFrame] = useState(0);
  const waiting = quest.status === QuestStatus.WAITING;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % FRAMES.length);
      setNow(Date.now());
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  const tip = TIPS[Math.floor((now - quest.startedAt) / TIP_MS + TIPS.indexOf(pick(TIPS, quest.id))) % TIPS.length];
  const agents = live?.agents ?? [];
  const details = [elapsed(now - quest.startedAt), live && live.outputTokens > 0 ? `↓ ${tokens(live.outputTokens)} tokens` : undefined, waiting ? undefined : phaseText(live)].filter(Boolean);

  return (
    <div className="ls" role="status" aria-live="off">
      <div className={`ls-line${waiting ? ' ls-waiting' : ''}`}>
        <span className="ls-spinner" aria-hidden="true">{waiting ? '◆' : FRAMES[frame]}</span>
        <span className="ls-verb">{waiting ? 'Waiting for your approval' : `${pick(VERBS, quest.id)}…`}</span>
        <span className="ls-detail">({details.join(' · ')})</span>
      </div>
      {agents.length > 0 ? (
        <div className="ls-sub">⎿ {agents.length === 1 ? '1 helper' : `${agents.length} helpers`} running: {agents.join(', ')}</div>
      ) : (
        <div className="ls-sub">⎿ Tip: {tip}</div>
      )}
    </div>
  );
};

// One-line form for tight rows (notch): spinner, time and tokens.
const LiveBadgeBase = ({ quest, live }: PropsType) => {
  const [now, setNow] = useState(Date.now());
  const [frame, setFrame] = useState(0);
  const waiting = quest.status === QuestStatus.WAITING;
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % FRAMES.length);
      setNow(Date.now());
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);
  const parts = [elapsed(now - quest.startedAt), live && live.outputTokens > 0 ? `↓ ${tokens(live.outputTokens)}` : undefined].filter(Boolean);
  return (
    <span className={`ls-badge${waiting ? ' ls-waiting' : ''}`} title={waiting ? 'Waiting for your approval' : phaseText(live)}>
      <span className="ls-spinner" aria-hidden="true">{waiting ? '◆' : FRAMES[frame]}</span>
      {waiting ? 'approve' : parts.join(' · ')}
    </span>
  );
};

export const LiveBadge = memo(LiveBadgeBase);

export default memo(LiveStatus);
