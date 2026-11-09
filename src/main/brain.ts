import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import type { CreatureType } from '@shared/types';
import type { ProfileConfigType } from './config';
import { expandGlob } from './registry';
import { DaycareMode } from '@shared/constants';
import { REMEMBER_HEADING } from './daycare';

// Inlined notes are re-sent with every message, so keep this small; anything over is listed
// by path for the creature to open when it matters.
const INLINE_BUDGET_CHARS = 16_000;

const localSkills = (creature: CreatureType): { name: string; path: string }[] => {
  const dir = join(creature.dir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name, 'SKILL.md') }))
    .filter((skill) => existsSync(skill.path));
};

export const brainFiles = (creature: CreatureType): string[] =>
  Array.from(new Set(creature.brain.flatMap((pattern) => expandGlob(pattern, creature.dir))));

export const buildSystemPrompt = (creature: CreatureType, profile: ProfileConfigType, party: CreatureType[] = [], extra = ''): string => {
  const files = brainFiles(creature);
  let budget = INLINE_BUDGET_CHARS;
  const inlined: string[] = [];
  const listed: string[] = [];
  files.forEach((file) => {
    const content = readFileSync(file, 'utf8');
    const label = relative(profile.vault, file);
    if (content.length <= budget) {
      inlined.push(`<note path="${label}">\n${content}\n</note>`);
      budget -= content.length;
    } else {
      listed.push(file);
    }
  });
  const skills = localSkills(creature);
  const teammates = party.filter((entry) => entry.id !== creature.id);
  const roster = teammates.map((entry) => `- ${entry.id} (${entry.name}): ${entry.role}`).join('\n');
  const lines = [
    `You are ${creature.name}, a specialist in the user's Trainer HQ party. Your role: ${creature.role}.`,
    creature.blurb,
    extra,
    `Your notes live in ${creature.dir}.`,
    profile.daycareMode === DaycareMode.FREE
      ? `If this chat taught you something durable and non-obvious about the user's work (a gotcha, contract, decision, file location or convention), end your answer with a line "${REMEMBER_HEADING}" followed by 1-3 short "- " bullets. Leave it out when there's nothing new.`
      : '',
    creature.skills.length > 0 ? `Prefer these skills when they apply: ${creature.skills.join(', ')}.` : '',
    skills.length > 0 ? `You also have local skills. Read them when relevant: ${skills.map((s) => s.path).join(', ')}.` : '',
    roster ? `Your teammates. When a question is outside your role, ask the right teammate with the ask_creature tool (creature id + a self-contained question) instead of guessing:\n${roster}` : '',
    listed.length > 0 ? `More notes you should read when relevant: ${listed.join(', ')}.` : '',
    inlined.length > 0 ? `Your brain notes:\n${inlined.join('\n\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
};
