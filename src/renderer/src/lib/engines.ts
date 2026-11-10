import { useEffect, useMemo, useState } from 'react';
import { Autonomy, CLAUDE_MODELS, EngineAdapter, type AutonomyType, type EngineAdapterType } from '@shared/constants';
import type { AppStateType, CreatureType } from '@shared/types';
import { AUTONOMY_INFO } from './format';

export type ModelChoiceType = { id: string; label: string; desc?: string };
export type ModelFamilyType = { name: string; variants: { id: string; effort: string }[] };

// "Gemini 4 Argon (High)" -> family "Gemini 4 Argon", effort "High".
const EFFORT_LABEL = /^(.*?)\s*\(([^)]+)\)\s*$/;
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

export const adapterOf = (state: AppStateType, engine: string): EngineAdapterType =>
  state.engineAdapters?.[engine] ?? (engine === 'claude' ? EngineAdapter.CLAUDE : EngineAdapter.CLI);

const toFamilies = (models: ModelChoiceType[]): ModelFamilyType[] => {
  const families = new Map<string, ModelFamilyType>();
  models.forEach((model) => {
    const match = EFFORT_LABEL.exec(model.label);
    const name = match ? match[1] : model.label;
    const family = families.get(name) ?? { name, variants: [] };
    family.variants.push({ id: model.id, effort: match ? match[2] : '' });
    families.set(name, family);
  });
  const rank = (effort: string): number => EFFORT_ORDER.indexOf(effort.toLowerCase());
  families.forEach((family) => family.variants.sort((a, b) => rank(a.effort) - rank(b.effort)));
  return [...families.values()];
};

// Prefer the medium variant when switching to a family.
export const defaultVariant = (family: ModelFamilyType): string =>
  (family.variants.find((variant) => variant.effort.toLowerCase() === 'medium') ?? family.variants[0]).id;

const CLAUDE_FAMILIES: ModelFamilyType[] = CLAUDE_MODELS.filter((model) => model.id).map((model) => ({ name: model.label, variants: [{ id: model.id, effort: '' }] }));

// Everything a model picker needs for one creature, whatever its engine.
export const useModelChoices = (state: AppStateType, creature: CreatureType | undefined) => {
  const engine = creature?.engine ?? '';
  const adapter = adapterOf(state, engine);
  const [listed, setListed] = useState<ModelChoiceType[] | null>(null);
  useEffect(() => {
    let live = true;
    setListed(null);
    if (!engine || adapter === EngineAdapter.CLAUDE) return undefined;
    void window.hq.engineModels(engine).then((models) => { if (live) setListed(models); }).catch(() => undefined);
    return () => { live = false; };
  }, [engine, adapter]);

  const families = useMemo(() => (adapter === EngineAdapter.CLAUDE ? CLAUDE_FAMILIES : toFamilies(listed ?? [])), [adapter, listed]);
  const current = creature?.model ?? '';
  const family = families.find((entry) => entry.variants.some((variant) => variant.id === current));
  return {
    adapter,
    families,
    current,
    family,
    loading: adapter !== EngineAdapter.CLAUDE && listed === null,
    // CLI engines we can't query get no picker.
    supported: adapter === EngineAdapter.CLAUDE || families.length > 0,
    custom: !!current && !family,
  };
};

type AutonomyTextType = { label: string; desc: string; mode: string };

// What each autonomy level really does depends on the engine; don't show Claude's modes for others.
export const autonomyText = (level: AutonomyType, adapter: EngineAdapterType): AutonomyTextType => {
  const base = AUTONOMY_INFO[level];
  if (adapter === EngineAdapter.CLAUDE) return { label: base.label, desc: base.desc, mode: base.mode };
  if (adapter === EngineAdapter.ANTIGRAVITY) {
    const byLevel: Record<AutonomyType, AutonomyTextType> = {
      [Autonomy.ASK]: { label: 'Read-only', desc: 'Antigravity can\'t ask from the background, so edits and commands are blocked.', mode: 'no flags' },
      [Autonomy.AUTO_EDIT]: { label: base.label, desc: 'Edits files freely. Commands that need permission are blocked.', mode: '--mode accept-edits' },
      [Autonomy.FULL_AUTO]: { label: base.label, desc: 'No approvals at all. Trainer HQ\'s deny list and worktrees don\'t apply.', mode: '--dangerously-skip-permissions' },
    };
    return byLevel[level];
  }
  return { label: base.label, desc: 'This CLI runs with its own permission defaults. Full auto only adds the time limit.', mode: 'engine defaults' };
};
