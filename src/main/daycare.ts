import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, normalize, relative } from 'path';
import { randomUUID } from 'crypto';
import YAML from 'yaml';
import type { CreatureType, DaycareNoteType, QuestType } from '@shared/types';
import { EventKind } from '@shared/constants';

const INBOX = join('daycare', 'inbox');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const TRANSCRIPT_LIMIT = 8_000;
const EVENT_LIMIT = 1_200;
const MIN_ANSWER_FOR_AI = 400;
const MAX_PROPOSALS = 5;

const inboxDir = (vault: string): string => join(vault, INBOX);

export const REMEMBER_HEADING = 'Worth remembering:';
const REMEMBER_SECTION = /(?:^|\n)\**Worth remembering:?\**:?[ \t]*\n((?:[ \t]*[-*] .+(?:\n|$))+)/i;

export type ProposalType = { target: string; body: string };

const lastAnswer = (quest: QuestType): string =>
  [...quest.events].reverse().find((event) => event.kind === EventKind.RESULT || event.kind === EventKind.TEXT)?.text ?? '';

// Free mode: the creature was asked to end with a "Worth remembering:" list. Read it, no model call.
export const inlineProposals = (vault: string, creature: CreatureType, quest: QuestType): ProposalType[] => {
  const match = REMEMBER_SECTION.exec(lastAnswer(quest));
  if (!match) return [];
  const target = relative(vault, join(creature.dir, creature.learnsInto, 'learned.md'));
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^[ \t]*[-*] /, '').trim())
    .filter(Boolean)
    .slice(0, MAX_PROPOSALS)
    .map((body) => ({ target, body }));
};

// AI mode only pays for a review when the chat did real work.
export const worthReviewing = (quest: QuestType): boolean =>
  quest.events.some((event) => event.kind === EventKind.TOOL) || lastAnswer(quest).length >= MIN_ANSWER_FOR_AI;

export const listDaycare = (vault: string): DaycareNoteType[] => {
  const dir = inboxDir(vault);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) => {
      const match = readFileSync(join(dir, name), 'utf8').match(FRONTMATTER);
      if (!match) return [];
      const meta = (YAML.parse(match[1]) ?? {}) as Record<string, string>;
      return [{
        id: name,
        creatureId: meta.creature ?? '',
        target: meta.target ?? '',
        source: meta.source ?? '',
        body: match[2].trim(),
      }];
    });
};

const insideVault = (vault: string, target: string): string | null => {
  const full = normalize(join(vault, target));
  return relative(vault, full).startsWith('..') ? null : full;
};

export const approveNote = (vault: string, id: string): boolean => {
  const note = listDaycare(vault).find((entry) => entry.id === id);
  if (!note) return false;
  const target = insideVault(vault, note.target);
  if (!target) return false;
  mkdirSync(dirname(target), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  appendFileSync(target, `\n\n## Learned ${stamp}\n\n${note.body}\n`);
  unlinkSync(join(inboxDir(vault), id));
  return true;
};

export const dismissNote = (vault: string, id: string): void => {
  const file = join(inboxDir(vault), id);
  if (existsSync(file)) unlinkSync(file);
};

export const buildProposalPrompt = (creature: CreatureType, quest: QuestType): string => {
  const transcript = quest.events
    .filter((event) => event.kind !== EventKind.SYSTEM)
    .map((event) => `[${event.kind}] ${event.text.slice(0, EVENT_LIMIT)}`)
    .join('\n')
    .slice(-TRANSCRIPT_LIMIT);
  return [
    `You maintain the long-term notes of ${creature.name} (${creature.role}).`,
    'Read this session transcript and extract only durable, non-obvious facts worth remembering next time: gotchas, contracts, decisions, file locations, conventions.',
    'Skip anything temporary, obvious, or already generic knowledge. If nothing qualifies, return an empty array.',
    `Return only a JSON array (max ${MAX_PROPOSALS}) of objects: {"target": "<vault-relative markdown path, normally under party/${creature.id}/${creature.learnsInto}>", "body": "<1-4 sentence markdown note>"}.`,
    '',
    transcript,
  ].join('\n');
};

export const parseProposals = (resultText: string): ProposalType[] => {
  const jsonMatch = resultText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const items = JSON.parse(jsonMatch[0]) as { target?: unknown; body?: unknown }[];
    return items.filter((item) => typeof item.target === 'string' && typeof item.body === 'string') as ProposalType[];
  } catch {
    return [];
  }
};

export const writeProposals = (vault: string, creature: CreatureType, quest: QuestType, items: ProposalType[]): string[] => {
  if (items.length === 0) return [];
  mkdirSync(inboxDir(vault), { recursive: true });
  return items
    .filter((item) => item.target && item.body && insideVault(vault, item.target))
    .slice(0, MAX_PROPOSALS)
    .map((item) => {
      const id = `${Date.now()}-${creature.id}-${randomUUID().slice(0, 6)}.md`;
      const meta = YAML.stringify({ creature: creature.id, target: item.target, source: `quest ${quest.id.slice(0, 8)} · ${quest.title}` });
      writeFileSync(join(inboxDir(vault), id), `---\n${meta}---\n${item.body}\n`);
      return id;
    });
};
