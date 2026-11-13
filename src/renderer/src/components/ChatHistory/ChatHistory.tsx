import { useMemo, useState } from 'react';
import { QuestKind, ThreadKind, type ThreadKindType } from '@shared/constants';
import type { AppStateType, ThreadType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import { timeAgo } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creatureId: string;
  onOpen: (threadId: string) => void;
  onClose: () => void;
};

const KIND_LABEL: Record<ThreadKindType, string> = {
  [ThreadKind.CHAT]: 'Thread',
  [ThreadKind.RECURRING]: 'Recurring quest',
  [ThreadKind.CLEARED]: 'Cleared chat',
};

const restedAt = (thread: ThreadType): number => thread.archivedAt ?? thread.updatedAt;

const ChatHistory = ({ state, creatureId, onOpen, onClose }: PropsType) => {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const past = useMemo(
    () => state.threads.filter((thread) => thread.creatureId === creatureId && thread.archived).sort((a, b) => restedAt(b) - restedAt(a)),
    [state.threads, creatureId],
  );
  const messages = useMemo(() => {
    const counts: Record<string, number> = {};
    state.quests.forEach((quest) => {
      if (quest.threadId && quest.kind === QuestKind.CHAT) counts[quest.threadId] = (counts[quest.threadId] ?? 0) + 1;
    });
    return counts;
  }, [state.quests]);

  const remove = (id: string): void => {
    setError(null);
    setConfirmingId(null);
    window.hq.deleteThread(id).catch((failure: Error) => {
      setError(failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    });
  };

  return (
    <>
      <div className="chist-backdrop" onClick={onClose} />
      <div className="chist" role="dialog" aria-label="Chat history">
        <div className="chist-head">
          <span className="eyebrow">History</span>
          <span className="faint">Reopen a chat to continue where it stopped.</span>
        </div>
        {renderIf(past.length === 0, <p className="faint chist-empty">Nothing here yet. Cleared and archived chats show up here.</p>)}
        <div className="chist-list">
          {past.map((thread) => {
            const count = messages[thread.id] ?? 0;
            return (
              <div key={thread.id} className="chist-row">
                <button className="chist-main" onClick={() => onOpen(thread.id)} title="Reopen this chat as a thread">
                  <span className="chist-title">{thread.title}</span>
                  <span className="chist-meta">
                    {KIND_LABEL[thread.kind ?? ThreadKind.CHAT]}
                    {thread.branch ? ` · ${thread.branch}` : ''}
                    {` · ${count === 1 ? '1 message' : `${count} messages`} · ${timeAgo(restedAt(thread))}`}
                  </span>
                </button>
                {renderIf(confirmingId !== thread.id, <button className="btn sm ghost" onClick={() => setConfirmingId(thread.id)}>Delete</button>)}
                {renderIf(confirmingId === thread.id, <button className="btn sm ghost danger" onClick={() => remove(thread.id)}>Delete for good</button>)}
              </div>
            );
          })}
        </div>
        {renderIf(!!error, <p className="chist-error selectable">{error}</p>)}
      </div>
    </>
  );
};

export default ChatHistory;
