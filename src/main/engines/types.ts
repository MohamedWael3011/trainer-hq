import type { QuestEventType, QuestUsageType, UsageType } from '@shared/types';

export type RunOutcomeType = {
  ok: boolean;
  resultText: string;
  error?: string;
  usageLimited: boolean;
  cancelled: boolean;
  timedOut: boolean;
  usage?: QuestUsageType;
};

export type RunHandleType = {
  cancel: () => void;
  done: Promise<RunOutcomeType>;
};

export type RunCallbacksType = {
  onEvent: (event: Omit<QuestEventType, 'at'>) => void;
  onSession?: (sessionId: string) => void;
  onUsage?: (usage: UsageType) => void;
  onQuestUsage?: (usage: QuestUsageType) => void;
};
