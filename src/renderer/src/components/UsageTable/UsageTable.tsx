import { memo } from 'react';
import type { AppStateType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import { renderIf } from '../../lib/renderIf';
import { creatureName, formatCost, formatTokens, percent } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const NEAR_BUDGET = 0.8;

const UsageTable = ({ state }: PropsType) => {
  const report = state.usageReport;
  const total = report.creatures.reduce((sum, row) => sum + row.costUsd, 0);
  return (
    <div className="panel usage">
      <div className="usage-head">
        <div className="eyebrow">Usage by creature · last {report.days} days</div>
        {renderIf(total > 0, <span className="faint">{formatCost(total)} at API rates</span>)}
      </div>
      {renderIf(report.creatures.length === 0, <p className="faint usage-empty">Fills in as creatures finish quests.</p>)}
      {renderIf(report.creatures.length > 0, (
        <div className="usage-grid" role="table">
          <div className="usage-row usage-row-head" role="row">
            <span>Creature</span><span>Quests</span><span>New tokens</span><span>Cached</span><span>Cost</span><span>Compactions</span><span>Cold restarts</span><span>This week</span>
          </div>
          {report.creatures.map((row) => {
            const cached = row.cacheReadTokens + row.freshTokens > 0 ? row.cacheReadTokens / (row.cacheReadTokens + row.freshTokens) : undefined;
            const budgetUse = row.weeklyBudgetUsd ? row.weekCostUsd / row.weeklyBudgetUsd : 0;
            return (
              <div key={row.creatureId} className="usage-row" role="row">
                <span className="usage-who"><Sprite state={state} id={row.creatureId} className="usage-sprite" />{creatureName(state, row.creatureId)}</span>
                <span>{row.quests}{row.handoffs > 0 ? ` (${row.handoffs} asked)` : ''}</span>
                <span>{formatTokens(row.freshTokens)}</span>
                <span>{percent(cached)}</span>
                <span>{formatCost(row.costUsd) ?? '–'}</span>
                <span className={row.compactions > 0 ? 'usage-warn' : undefined}>{row.compactions}</span>
                <span>{row.coldResets}</span>
                <span className={budgetUse >= NEAR_BUDGET ? 'usage-warn' : undefined}>
                  {formatCost(row.weekCostUsd) ?? '–'}{row.weeklyBudgetUsd ? ` / ${formatCost(row.weeklyBudgetUsd)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default memo(UsageTable);
