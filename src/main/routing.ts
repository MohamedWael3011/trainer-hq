import { AUTO_MODEL, QuestKind, type QuestKindType } from '@shared/constants';

const LOOKUP_MAX_CHARS = 280;
const LOOKUP_OPENING = /^(what|where|which|who|when|why|how|is|are|was|were|does|do|did|can|could|should|show|list|find|explain|summari[sz]e|tell me|check|remind me)\b/i;
const ACTION_WORD = /\b(implement|fix|refactor|rewrite|write|build|create|add|change|update|edit|migrate|deploy|render|commit|push|run|generate|make|design|audit|review|remove|delete|rename|open a pr|test)\b/i;
const HAS_PATH_OR_CODE = /```|(?:^|\s)~?\/[\w.-]+\//;
const LIGHT_FAMILY = /sonnet|haiku/i;

export const isLightModel = (model: string | undefined): boolean => !!model && LIGHT_FAMILY.test(model);

export const isLookup = (prompt: string): boolean => {
  const text = prompt.trim();
  if (!text || text.length > LOOKUP_MAX_CHARS || text.startsWith('/')) return false;
  if (text.split('\n').filter((line) => line.trim()).length > 2) return false;
  if (HAS_PATH_OR_CODE.test(text)) return false;
  return LOOKUP_OPENING.test(text) && !ACTION_WORD.test(text);
};

export type RoutedModelType = {
  model?: string;
  routed: boolean;
};

export const resolveModel = (options: {
  model?: string;
  kind: QuestKindType;
  prompt: string;
  lightModel: string;
  sessionModel?: string;
  resumed: boolean;
}): RoutedModelType => {
  const { kind, prompt, lightModel, sessionModel, resumed } = options;
  const auto = options.model === AUTO_MODEL;
  const base = auto ? undefined : options.model;
  if (!lightModel) return { model: base, routed: false };
  if (kind === QuestKind.HANDOFF) return isLightModel(base) ? { model: base, routed: false } : { model: lightModel, routed: true };
  if (!auto || !isLookup(prompt)) return { model: base, routed: false };
  if (resumed && !isLightModel(sessionModel)) return { model: base, routed: false };
  return { model: lightModel, routed: true };
};
