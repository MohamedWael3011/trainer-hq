import { Autonomy, QuestStatus, SPRITE_HOST, SPRITE_PROTOCOL, type AutonomyType, type QuestStatusType } from '@shared/constants';
import type { AppStateType, CreatureType, QuestType } from '@shared/types';

export const BadgeTone = {
  NEUTRAL: 'neutral',
  RUN: 'run',
  WAIT: 'wait',
  DONE: 'done',
  FAIL: 'fail',
  AUTO: 'auto',
} as const;
export type BadgeToneType = (typeof BadgeTone)[keyof typeof BadgeTone];

export const STATUS_LABEL: Record<QuestStatusType, string> = {
  [QuestStatus.RUNNING]: 'Running',
  [QuestStatus.WAITING]: 'Needs you',
  [QuestStatus.DONE]: 'Done',
  [QuestStatus.FAILED]: 'Failed',
  [QuestStatus.PAUSED]: 'Paused',
  [QuestStatus.CANCELLED]: 'Cancelled',
};

export const STATUS_TONE: Record<QuestStatusType, BadgeToneType> = {
  [QuestStatus.RUNNING]: BadgeTone.RUN,
  [QuestStatus.WAITING]: BadgeTone.WAIT,
  [QuestStatus.DONE]: BadgeTone.DONE,
  [QuestStatus.FAILED]: BadgeTone.FAIL,
  [QuestStatus.PAUSED]: BadgeTone.WAIT,
  [QuestStatus.CANCELLED]: BadgeTone.NEUTRAL,
};

export const AUTONOMY_INFO: Record<AutonomyType, { label: string; desc: string; mode: string; tone: BadgeToneType }> = {
  [Autonomy.ASK]: { label: 'Ask every time', desc: 'Approve each edit and command.', mode: 'manual', tone: BadgeTone.NEUTRAL },
  [Autonomy.AUTO_EDIT]: { label: 'Auto-edit', desc: 'Edits files freely. Asks before commands.', mode: 'acceptEdits', tone: BadgeTone.NEUTRAL },
  [Autonomy.FULL_AUTO]: { label: 'Full auto', desc: 'No approvals. Runs inside the guard.', mode: 'bypassPermissions', tone: BadgeTone.AUTO },
};

export const LIVE_STATUSES: QuestStatusType[] = [QuestStatus.RUNNING, QuestStatus.WAITING];

export const isLive = (quest: QuestType): boolean => LIVE_STATUSES.includes(quest.status);

export const spriteUrl = (state: AppStateType, id: string): string =>
  `${SPRITE_PROTOCOL}://${SPRITE_HOST}/${encodeURIComponent(id)}?v=${state.spriteRev[id] ?? 0}`;

export const creatureById = (state: AppStateType, id: string): CreatureType | undefined =>
  state.creatures.find((creature) => creature.id === id);

export const creatureName = (state: AppStateType, id: string): string => creatureById(state, id)?.name ?? id;

export const percent = (value: number | undefined): string => (value === undefined ? '–' : `${Math.round(value * 100)}%`);

export const timeAgo = (at: number): string => {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const duration = (quest: QuestType): string => {
  const end = quest.endedAt ?? Date.now();
  const seconds = Math.max(1, Math.round((end - quest.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
};

export const parseMention = (input: string, state: AppStateType, fallbackId: string): { creatureId: string; text: string } => {
  const match = input.match(/^@([\w-]+)\s+([\s\S]+)$/);
  if (!match) return { creatureId: fallbackId, text: input.trim() };
  const key = match[1].toLowerCase();
  const creature = state.creatures.find((entry) => entry.id.toLowerCase() === key || entry.name.toLowerCase() === key);
  return creature ? { creatureId: creature.id, text: match[2].trim() } : { creatureId: fallbackId, text: input.trim() };
};
