import { Autonomy, type AutonomyType } from '@shared/constants';
import type { AppStateType, CreatureType } from '@shared/types';
import { renderIf } from '../../lib/renderIf';
import { autonomyText, defaultVariant, useModelChoices } from '../../lib/engines';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creature: CreatureType;
};

const AUTONOMY_ORDER: AutonomyType[] = [Autonomy.ASK, Autonomy.AUTO_EDIT, Autonomy.FULL_AUTO];
const DEFAULT_MODEL = '';
const CUSTOM_MODEL = '__custom__';

// Engine, model and autonomy for one creature, editable right from its chat.
const CreatureControls = ({ state, creature }: PropsType) => {
  const models = useModelChoices(state, creature);
  const autonomy = autonomyText(creature.autonomy, models.adapter);
  const familyValue = models.family ? models.family.name : models.custom ? CUSTOM_MODEL : DEFAULT_MODEL;

  const onFamily = (name: string): void => {
    if (name === CUSTOM_MODEL) return;
    const family = models.families.find((entry) => entry.name === name);
    void window.hq.setModel(creature.id, family ? defaultVariant(family) : DEFAULT_MODEL);
  };

  return (
    <div className="cc">
      {renderIf(state.engines.length > 1, (
        <label className="cc-field">
          <span>Engine</span>
          <select value={creature.engine} onChange={(event) => void window.hq.setEngine(creature.id, event.target.value)}>
            {state.engines.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
          </select>
        </label>
      ))}
      {renderIf(models.supported || models.loading, (
        <label className="cc-field">
          <span>Model</span>
          <select value={familyValue} disabled={models.loading} onChange={(event) => onFamily(event.target.value)}>
            <option value={DEFAULT_MODEL}>{models.loading ? 'Loading…' : 'Default'}</option>
            {models.families.map((family) => <option key={family.name} value={family.name}>{family.name}</option>)}
            {renderIf(models.custom, <option value={CUSTOM_MODEL}>{models.current}</option>)}
          </select>
        </label>
      ))}
      {renderIf(!!models.family && models.family.variants.length > 1, (
        <label className="cc-field">
          <span>Effort</span>
          <select value={models.current} onChange={(event) => void window.hq.setModel(creature.id, event.target.value)}>
            {models.family?.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.effort || variant.id}</option>)}
          </select>
        </label>
      ))}
      <label className="cc-field" title={autonomy.desc}>
        <span>Autonomy</span>
        <select
          className={creature.autonomy === Autonomy.FULL_AUTO ? 'cc-full' : undefined}
          value={creature.autonomy}
          onChange={(event) => void window.hq.setAutonomy(creature.id, event.target.value as AutonomyType)}
        >
          {AUTONOMY_ORDER.map((level) => <option key={level} value={level}>{autonomyText(level, models.adapter).label}</option>)}
        </select>
      </label>
    </div>
  );
};

export default CreatureControls;
