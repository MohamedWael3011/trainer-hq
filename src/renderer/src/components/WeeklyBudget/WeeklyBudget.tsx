import { useEffect, useState, type FormEvent } from 'react';
import type { AppStateType, CreatureType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import { formatCost } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creature: CreatureType;
};

const WeeklyBudget = ({ state, creature }: PropsType) => {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft(creature.weeklyBudgetUsd ? String(creature.weeklyBudgetUsd) : '');
  }, [creature.id, creature.weeklyBudgetUsd]);
  const spent = state.usageReport.creatures.find((row) => row.creatureId === creature.id)?.weekCostUsd ?? 0;
  const save = (event: FormEvent): void => {
    event.preventDefault();
    void window.hq.setCreatureBudget(creature.id, Number(draft) || 0);
  };
  return (
    <div className="dex-block">
      <div className="eyebrow">Weekly budget</div>
      <form className="wbudget" onSubmit={save}>
        <label className="wbudget-field">
          <span>$</span>
          <input type="number" min={0} step={1} value={draft} placeholder="No limit" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button className="btn sm" type="submit">Save</button>
        <span className="muted">
          {formatCost(spent) ?? '$0.00'}
          {renderIf(!!creature.weeklyBudgetUsd, ` of ${formatCost(creature.weeklyBudgetUsd)}`)}
          {' used in the last 7 days, at API rates. '}
          {renderIf(!!creature.weeklyBudgetUsd, 'New quests pause once the budget is reached.')}
          {renderIf(!creature.weeklyBudgetUsd, 'Leave empty for no limit.')}
        </span>
      </form>
    </div>
  );
};

export default WeeklyBudget;
