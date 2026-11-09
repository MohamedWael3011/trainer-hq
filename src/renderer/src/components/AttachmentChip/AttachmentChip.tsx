import { memo, useCallback, useState } from 'react';
import { AttachmentKind } from '@shared/constants';
import type { AttachmentInfoType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  attachment: AttachmentInfoType;
  creatureId: string;
  creatureName: string;
  onRemove: (path: string) => void;
};

const KIND_LABEL: Record<AttachmentInfoType['kind'], string> = {
  [AttachmentKind.FILE]: 'file',
  [AttachmentKind.FOLDER]: 'folder',
  [AttachmentKind.ZIP]: 'zip · unpacked on send',
  [AttachmentKind.SKILL]: 'skill',
};

const AttachmentChip = ({ attachment, creatureId, creatureName, onRemove }: PropsType) => {
  const [message, setMessage] = useState<string | null>(null);
  const install = useCallback(async (forCreature: boolean) => {
    try {
      const name = await window.hq.installSkill({ path: attachment.path, creatureId: forCreature ? creatureId : undefined });
      setMessage(forCreature ? `Installed "${name}" for ${creatureName}` : `Installed "${name}" for every creature`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }, [attachment.path, creatureId, creatureName]);

  return (
    <div className="chip">
      <span className="chip-name" title={attachment.path}>{attachment.name}</span>
      <span className="chip-kind">{attachment.kind === AttachmentKind.SKILL ? `skill · ${attachment.skillName}` : KIND_LABEL[attachment.kind]}</span>
      {renderIf(attachment.kind === AttachmentKind.SKILL && !message, (
        <span className="chip-actions">
          <button className="btn sm primary" onClick={() => void install(true)}>Install for {creatureName}</button>
          <button className="btn sm" onClick={() => void install(false)}>Install for all</button>
        </span>
      ))}
      {renderIf(!!message, <span className="chip-done">{message}</span>)}
      <button className="chip-remove" onClick={() => onRemove(attachment.path)} aria-label={`Remove ${attachment.name}`}>×</button>
    </div>
  );
};

export default memo(AttachmentChip);
