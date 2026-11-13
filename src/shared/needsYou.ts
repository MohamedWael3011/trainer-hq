import { QuestStatus } from './constants';
import type { AppStateType, QuestType } from './types';

const LIVE = new Set<string>([QuestStatus.RUNNING, QuestStatus.WAITING]);

// Finished quests that changed files and have not been approved or discarded yet, newest first.
export const reviewQueue = (quests: QuestType[]): QuestType[] =>
  quests.filter((quest) => !LIVE.has(quest.status) && !quest.review && (quest.changedFiles?.length ?? 0) > 0);

export type NeedsYouType = {
  approvals: number;
  reviews: number;
  total: number;
  // Creatures with an approval or a review waiting, so the dock and notch can mark each one.
  creatureIds: Set<string>;
};

// What is waiting on the user right now: approvals block a running quest, reviews wait on finished work.
export const needsYou = (state: Pick<AppStateType, 'approvals' | 'quests'>): NeedsYouType => {
  const reviews = reviewQueue(state.quests);
  const creatureIds = new Set<string>([
    ...state.approvals.map((approval) => approval.creatureId),
    ...reviews.map((quest) => quest.creatureId),
  ]);
  return { approvals: state.approvals.length, reviews: reviews.length, total: state.approvals.length + reviews.length, creatureIds };
};
