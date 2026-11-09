import { memo, useCallback } from 'react';
import { Decision, type DecisionType } from '@shared/constants';
import type { AppStateType, ApprovalType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import { creatureName } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  approval: ApprovalType;
  compact?: boolean;
};

const ApprovalCard = ({ state, approval, compact = false }: PropsType) => {
  const decide = useCallback(
    (decision: DecisionType) => void window.hq.decideApproval({ id: approval.id, decision }),
    [approval.id],
  );
  return (
    <div className={`approval${compact ? ' approval-compact' : ''}`}>
      <Sprite state={state} id={approval.creatureId} className="approval-sprite" />
      <div className="approval-body">
        <div className="approval-title">{creatureName(state, approval.creatureId)} wants to use {approval.toolName}</div>
        <code className="approval-summary selectable">{approval.summary}</code>
        <div className="approval-actions">
          <button className="btn primary sm" onClick={() => decide(Decision.ALLOW)}>Allow</button>
          <button className="btn sm" onClick={() => decide(Decision.ALLOW_QUEST)}>Allow for this quest</button>
          <button className="btn sm ghost danger" onClick={() => decide(Decision.DENY)}>Deny</button>
        </div>
      </div>
    </div>
  );
};

export default memo(ApprovalCard);
