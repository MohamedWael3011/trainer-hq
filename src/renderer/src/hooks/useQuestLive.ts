import { useEffect, useState } from 'react';
import type { QuestLiveType } from '@shared/types';

// One IPC subscription shared by every component that shows live progress.
let snapshot: Record<string, QuestLiveType> = {};
const listeners = new Set<() => void>();
let started = false;

const start = (): void => {
  if (started) return;
  started = true;
  const apply = (next: Record<string, QuestLiveType>): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  void window.hq.getLive().then(apply);
  window.hq.onLive(apply);
};

export const useQuestLive = (questId: string | undefined): QuestLiveType | undefined => {
  const [live, setLive] = useState<QuestLiveType | undefined>(() => (questId ? snapshot[questId] : undefined));
  useEffect(() => {
    if (!questId) return undefined;
    start();
    const update = (): void => setLive(snapshot[questId]);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [questId]);
  return live;
};
