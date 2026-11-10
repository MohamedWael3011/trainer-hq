import { useCallback, type ChangeEvent } from 'react';
import { Autonomy, CLAUDE_MODELS, EngineAdapter, type AutonomyType } from '@shared/constants';
import type { AppStateType } from '@shared/types';
import Sprite from '../../components/Sprite/Sprite';
import Badge from '../../components/Badge/Badge';
import { renderIf } from '../../lib/renderIf';
import { creatureById } from '../../lib/format';
import { autonomyText, defaultVariant, useModelChoices } from '../../lib/engines';
import './styles.css';

type PropsType = {
  state: AppStateType;
  creatureId: string;
};

const AUTONOMY_ORDER: AutonomyType[] = [Autonomy.ASK, Autonomy.AUTO_EDIT, Autonomy.FULL_AUTO];

const Dex = ({ state, creatureId }: PropsType) => {
  const creature = creatureById(state, creatureId);
  const models = useModelChoices(state, creature);
  const onSprite = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && creature) void window.hq.setSprite(creature.id, file);
    event.target.value = '';
  }, [creature]);

  if (!creature) return <div className="dex-empty">No creature selected.</div>;
  const isFull = creature.autonomy === Autonomy.FULL_AUTO;
  const isClaude = models.adapter === EngineAdapter.CLAUDE;
  const currentModel = models.current;
  const currentFamily = models.family;

  return (
    <section className="dex">
      <div className="dex-hero">
        <div className="dex-stage"><Sprite state={state} id={creature.id} className="dex-sprite" /></div>
        <div className="dex-info">
          <span className="faint">No.{String(creature.no).padStart(3, '0')}</span>
          <h2>{creature.name}</h2>
          <div className="dex-tags">
            <Badge>{creature.role}</Badge>
            <Badge>{creature.engine}</Badge>
            {creature.types.map((type) => <Badge key={type}>{type}</Badge>)}
          </div>
          {renderIf(!!creature.blurb, <p className="muted dex-blurb">{creature.blurb}</p>)}
          <div className="dex-actions">
            <label className="btn sm dex-upload">Change sprite<input type="file" accept="image/png,image/gif,image/webp" onChange={onSprite} /></label>
            <button className="btn sm ghost" onClick={() => void window.hq.resetSprite(creature.id)}>Use original</button>
            <button className="btn sm ghost" onClick={() => void window.hq.openPath(creature.dir)}>Open folder</button>
          </div>
        </div>
      </div>

      <div className="dex-block">
        <div className="eyebrow">Autonomy</div>
        <div className="dex-auto">
          {AUTONOMY_ORDER.map((level) => {
            const info = autonomyText(level, models.adapter);
            return (
              <button
                key={level}
                className={`dex-auto-opt${level === Autonomy.FULL_AUTO ? ' dex-auto-full' : ''}`}
                aria-pressed={creature.autonomy === level}
                onClick={() => void window.hq.setAutonomy(creature.id, level)}
              >
                <b>{info.label}</b>
                <span>{info.desc}</span>
                <code>{info.mode}</code>
              </button>
            );
          })}
        </div>
        {renderIf(isFull && !isClaude, (
          <div className="dex-guard dex-guard-warn">
            <b>Claude's guard doesn't cover this engine</b>
            <ul>
              <li>{models.adapter === EngineAdapter.ANTIGRAVITY ? 'Antigravity runs with every permission granted' : 'The CLI runs with its own permission defaults'}</li>
              <li>Your deny list, worktrees and the plan-usage pause don't apply</li>
              <li>It still stops at your profile's time limit per quest</li>
              <li>Stop any quest from the notch with ⌘ .</li>
            </ul>
          </div>
        ))}
        {renderIf(isFull && isClaude, (
          <div className="dex-guard">
            <b>Full auto still runs inside the guard</b>
            <ul>
              <li>Works in its own git worktree when its folder is a repo</li>
              <li>Never pushes, force-resets, merges or rebases</li>
              <li>Blocks rm -rf, sudo and .env reads, plus your profile's deny list</li>
              <li>Stops at your profile's time limit per quest</li>
              <li>Pauses when your plan's usage limit is reached</li>
              <li>Stop any quest from the notch with ⌘ .</li>
            </ul>
          </div>
        ))}
      </div>

      {renderIf(state.engines.length > 1, (
        <div className="dex-block">
          <div className="eyebrow">Engine</div>
          <div className="dex-engine">
            {state.engines.map((engine) => (
              <button
                key={engine}
                className="btn sm ghost dex-engine-opt"
                aria-pressed={creature.engine === engine}
                onClick={() => void window.hq.setEngine(creature.id, engine)}
              >
                {engine}
              </button>
            ))}
          </div>
        </div>
      ))}

      {renderIf(isClaude, (
        <div className="dex-block">
          <div className="eyebrow">Model</div>
          <div className="dex-auto dex-model">
            {CLAUDE_MODELS.map((option) => (
              <button
                key={option.id || 'default'}
                className="dex-auto-opt"
                aria-pressed={currentModel === option.id}
                onClick={() => void window.hq.setModel(creature.id, option.id)}
              >
                <b>{option.label}</b>
                <span>{option.desc}</span>
                <code>{option.cost}</code>
              </button>
            ))}
          </div>
          {renderIf(models.custom, <p className="muted">Using <code>{currentModel}</code> from creature.yaml.</p>)}
        </div>
      ))}

      {renderIf(!isClaude && models.families.length > 0, (
        <div className="dex-block">
          <div className="eyebrow">Model</div>
          <div className="dex-auto dex-model">
            <button className="dex-auto-opt" aria-pressed={!currentModel} onClick={() => void window.hq.setModel(creature.id, '')}>
              <b>Default</b>
              <span>Follows your CLI setting</span>
              <code>CLI default</code>
            </button>
            {models.families.map((family) => (
              <button
                key={family.name}
                className="dex-auto-opt"
                aria-pressed={currentFamily?.name === family.name}
                onClick={() => void window.hq.setModel(creature.id, defaultVariant(family))}
              >
                <b>{family.name}</b>
                {renderIf(!!family.desc, <span>{family.desc}</span>)}
                {renderIf(!!family.cost, <code>{family.cost}</code>)}
              </button>
            ))}
          </div>
          {renderIf(!!currentFamily && currentFamily.variants.length > 1, (
            <div className="dex-effort">
              <span className="faint">Effort</span>
              <div className="seg">
                {currentFamily?.variants.map((variant) => (
                  <button key={variant.id} type="button" aria-pressed={variant.id === currentModel} onClick={() => void window.hq.setModel(creature.id, variant.id)}>{variant.effort || variant.id}</button>
                ))}
              </div>
            </div>
          ))}
          {renderIf(!!currentModel && !currentFamily, <p className="muted">Using <code>{currentModel}</code> from creature.yaml.</p>)}
        </div>
      ))}

      <div className="dex-grid">
        <div className="panel"><div className="eyebrow">Brain</div><ul>{creature.brain.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div className="panel"><div className="eyebrow">Skills</div><ul>{creature.skills.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div className="panel"><div className="eyebrow">Allowed tools</div><ul>{creature.tools.allow.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div className="panel"><div className="eyebrow">Habitat</div><ul><li>{creature.cwd ?? state.profile.vault}</li>{creature.addDirs.map((dir) => <li key={dir}>{dir}</li>)}</ul></div>
      </div>
    </section>
  );
};

export default Dex;
