import type { QuestEventType, QuestLiveType, QuestUsageType, UsageType } from '@shared/types';

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
  // Hand a follow-up message to the running engine. Returns false when it can't take more input.
  send?: (text: string) => boolean;
};

export type RunCallbacksType = {
  onEvent: (event: Omit<QuestEventType, 'at'>) => void;
  onSession?: (sessionId: string) => void;
  onUsage?: (usage: UsageType) => void;
  onQuestUsage?: (usage: QuestUsageType) => void;
  onLive?: (live: QuestLiveType) => void;
};
