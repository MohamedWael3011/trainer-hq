import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join, relative } from 'path';
import YAML from 'yaml';
import type { CreatureType } from '@shared/types';
import type { ProfileConfigType } from './config';
import { expandGlob } from './registry';
import { DaycareMode, EngineAdapter } from '@shared/constants';
import { REMEMBER_HEADING } from './daycare';

// Keep always-on inline memory tight (~900 tokens max): only core identity/workspace notes are inlined,
// while domain notes and Day Care learned history are indexed with section line ranges and pulled on demand.
const HOT_BUDGET_CHARS = 3_600;
const FALLBACK_HOT_LIMIT_CHARS = 1_500;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const LEARNED_MARKER = /(?:^|\n)## Learned\b/;
const CORE_NOTE_NAME = /^(01-workspace|workspace|how-i-work|my-style|scope|rules|index|_index)\.md$/i;

type SectionSpanType = {
  heading: string;
  startLine: number;
  endLine: number;
};

type ParsedNoteType = {
  file: string;
  base: string;
  label: string;
  title: string;
  tags: string[];
  summary?: string;
  tier: 'hot' | 'warm' | 'cold';
  coreBody: string;
  totalLines: number;
  sections: SectionSpanType[];
  learnedCount: number;
};

const localSkills = (creature: CreatureType): { name: string; path: string }[] => {
  const dir = join(creature.dir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name, 'SKILL.md') }))
    .filter((skill) => existsSync(skill.path));
};

export const brainFiles = (creature: CreatureType): string[] =>
  Array.from(new Set(creature.brain.flatMap((pattern) => expandGlob(pattern, creature.dir))));

const parseSections = (rawLines: string[]): SectionSpanType[] => {
  const sections: SectionSpanType[] = [];
  rawLines.forEach((line, index) => {
    const match = line.match(/^##+\s+(.+)$/);
    if (!match) return;
    if (sections.length > 0) sections[sections.length - 1].endLine = index;
    sections.push({ heading: match[1].trim(), startLine: index + 1, endLine: rawLines.length });
  });
  return sections;
};

const parseNote = (file: string, vault: string, hasNumberedWorkspace: boolean): ParsedNoteType => {
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const base = basename(file);
  const label = relative(vault, file);
  const match = raw.match(FRONTMATTER);
  let meta: Record<string, unknown> = {};
  let body = raw.trim();
  if (match) {
    try {
      meta = (YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    body = match[2].trim();
  }
  const sections = parseSections(rawLines);
  const learnedSplit = body.split(LEARNED_MARKER);
  const coreBody = learnedSplit[0].trim();
  const learnedCount = Math.max(0, learnedSplit.length - 1);
  const rawTier = String(meta.tier ?? '').toLowerCase();
  const isHotMeta = rawTier === 'hot' || meta.always === true;
  const isColdMeta = rawTier === 'cold';
  const isDuplicateWorkspace = base.toLowerCase() === 'workspace.md' && hasNumberedWorkspace;
  const isCoreFile = CORE_NOTE_NAME.test(base) && !isDuplicateWorkspace && !label.startsWith('shared/');
  const tier: 'hot' | 'warm' | 'cold' = isColdMeta
    ? 'cold'
    : isHotMeta || (isCoreFile && coreBody.length > 0)
      ? 'hot'
      : 'warm';
  return {
    file,
    base,
    label,
    title: typeof meta.title === 'string' ? meta.title : basename(file, '.md'),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    summary: typeof meta.summary === 'string' ? meta.summary : undefined,
    tier,
    coreBody,
    totalLines: rawLines.length,
    sections,
    learnedCount,
  };
};

const TEMPLATE_SHARED_README = 'Put notes every creature should know here';

const formatIndexEntry = (note: ParsedNoteType, creatureDir: string, coreInlined: boolean): string => {
  const relPath = relative(creatureDir, note.file);
  const fileSlug = basename(note.file, '.md').toLowerCase().replace(/[-_]+/g, ' ');
  const normTitle = note.title.toLowerCase().replace(/[-_]+/g, ' ');
  const titlePart = normTitle !== fileSlug ? ` "${note.title}"` : '';
  const tagText = note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
  const summaryText = note.summary ? ` — ${note.summary}` : '';
  const shownSections = coreInlined
    ? note.sections.filter((s) => /^Learned\b/i.test(s.heading))
    : note.sections.filter((s) => !/^Learned\s+\d{4}-\d{2}-\d{2}$/i.test(s.heading) || note.sections.length > 1);
  const sectionText =
    shownSections.length > 0
      ? ` · ${shownSections
          .slice(0, 6)
          .map((s) => `${s.heading} (L${s.startLine}-${s.endLine})`)
          .join(', ')}`
      : ` (L1-${note.totalLines})`;
  return `- ${relPath}${titlePart}${tagText}${summaryText}${sectionText}`;
};

const placeNotes = (creature: CreatureType, profile: ProfileConfigType): { note: ParsedNoteType; inline: boolean }[] => {
  const files = brainFiles(creature);
  const hasNumberedWorkspace = files.some((file) => basename(file).toLowerCase() === '01-workspace.md');
  const notes = files
    .map((file) => parseNote(file, profile.vault, hasNumberedWorkspace))
    .filter((note) => !(note.label === 'shared/README.md' && note.coreBody.includes(TEMPLATE_SHARED_README)));
  // If an existing creature has no named core file yet, promote its first short non-Learned note to hot.
  if (!notes.some((n) => n.tier === 'hot')) {
    const candidate = notes.find((n) => n.tier === 'warm' && n.coreBody.length > 0 && n.coreBody.length <= FALLBACK_HOT_LIMIT_CHARS && !n.label.startsWith('shared/'));
    if (candidate) candidate.tier = 'hot';
  }
  let budget = HOT_BUDGET_CHARS;
  return notes.map((note) => {
    const inline = note.tier === 'hot' && note.coreBody.length > 0 && note.coreBody.length <= budget;
    if (inline) budget -= note.coreBody.length;
    return { note, inline };
  });
};

export const inlinedNotePaths = (creature: CreatureType, profile: ProfileConfigType): string[] =>
  placeNotes(creature, profile).filter((entry) => entry.inline).map((entry) => entry.note.file);

export const buildSystemPrompt = (creature: CreatureType, profile: ProfileConfigType, party: CreatureType[] = [], extra = ''): string => {
  const inlined: string[] = [];
  const indexed: string[] = [];

  placeNotes(creature, profile).forEach(({ note, inline }) => {
    if (inline) {
      inlined.push(`<note path="${note.label}">\n${note.coreBody}\n</note>`);
      if (note.learnedCount > 0) indexed.push(formatIndexEntry(note, creature.dir, true));
    } else {
      indexed.push(formatIndexEntry(note, creature.dir, false));
    }
  });

  const skills = localSkills(creature);
  const teammates = party.filter((entry) => entry.id !== creature.id);
  const roster = teammates.map((entry) => `- ${entry.id} (${entry.name}): ${entry.role}`).join('\n');
  const usesClaudeCode = (profile.engines[creature.engine] ?? profile.engines.claude)?.adapter === EngineAdapter.CLAUDE;
  const lines = [
    `You are ${creature.name}, a specialist in the user's Trainer HQ party. Your role: ${creature.role}.`,
    creature.blurb,
    extra,
    `Your notes live in ${creature.dir}.`,
    'Keep the conversation lean: everything you read stays in context and is resent on every step. Find things with Grep/Glob first, Read big files with offset/limit instead of whole, never re-read a file you already have, change code with Edit rather than writing throwaway patch scripts, and keep command output short (head, --stat, -n).',
    'Images are costly to look at: open one at a time, and when a screenshot is larger than you need, shrink a copy first (sips -Z 1568 file --out copy) or build one contact sheet instead of reading many files.',
    // Helper agents are Claude Code's Agent tool; other engines don't have it.
    usesClaudeCode
      ? 'For broad searches across many files, or reading long docs, PDFs or logs, hand the reading to a helper agent (the Agent tool, e.g. Explore) and work from its summary: it reads in its own context, so yours stays small.'
      : '',
    usesClaudeCode
      ? 'When the user wants something to repeat (a daily refresh, a weekly report), create it with the schedule_quest tool so Trainer HQ runs it. Session crons, loops and sleeps end with your reply and never fire.'
      : '',
    profile.daycareMode === DaycareMode.FREE
      ? `If this chat taught you something durable and non-obvious about the user's work (a gotcha, contract, decision, file location or convention), end your answer with a line "${REMEMBER_HEADING}" followed by 1-3 short "- " bullets. Leave it out when there's nothing new.`
      : '',
    creature.skills.length > 0 ? `Prefer these skills when they apply: ${creature.skills.join(', ')}.` : '',
    skills.length > 0 ? `You also have local skills. Read them when relevant: ${skills.map((s) => s.path).join(', ')}.` : '',
    roster ? `Your teammates. When a question is outside your role, ask the right teammate with the ask_creature tool (creature id + a self-contained question) instead of guessing:\n${roster}` : '',
    inlined.length > 0 ? `Your core brain notes:\n${inlined.join('\n\n')}` : '',
    indexed.length > 0
      ? `More brain notes (pull only relevant sections on demand with Read offset/limit or Grep instead of loading everything):\n${indexed.join('\n')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n\n');
};
