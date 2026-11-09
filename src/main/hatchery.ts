import { join } from 'path';
import { Autonomy, BUILTIN_SPRITE_PREFIX, HATCHERY_ID } from '@shared/constants';
import type { CreatureType, HatchRequestType } from '@shared/types';
import type { ProfileConfigType } from './config';

export const BUILTIN_SPRITES = [
  'pigabyte', 'flacono', 'anoleaf', 'grintrock', 'tweesher', 'cairfrey', 'eyenemy', 'hampotamos', 'hatchling',
];

export const hatcheryCreature = (profile: ProfileConfigType, repos: string[]): CreatureType => ({
  id: HATCHERY_ID,
  no: 0,
  name: 'Hatchery',
  role: 'Creates new creatures from a description',
  blurb: '',
  types: [],
  sprite: `${BUILTIN_SPRITE_PREFIX}hatchling`,
  engine: 'claude',
  cwd: profile.vault,
  addDirs: repos.map((name) => profile.repos[name]).filter(Boolean),
  brain: [],
  skills: [],
  tools: {
    allow: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash(ls:*)', 'Bash(git log:*)', 'Bash(mkdir:*)'],
    ask: [],
    deny: ['Bash(git commit:*)', 'Bash(npm:*)', 'Bash(yarn:*)'],
  },
  autonomy: Autonomy.AUTO_EDIT,
  learnsInto: 'brain/',
  learnsReview: true,
  dir: join(profile.vault, 'party'),
});

export const buildHatchPrompt = (request: HatchRequestType, profile: ProfileConfigType, nextNo: number): string => {
  const repoLines = request.repos.map((name) => `- ${name}: ${profile.repos[name]}`).join('\n') || '- (none selected)';
  return `You are the Trainer HQ Hatchery. Create one new creature (a specialist agent) in this vault: ${profile.vault}

The user described it like this:
"""
${request.prompt}
"""

Repos it may read (read-only for you, never modify them):
${repoLines}

Steps:
1. Pick a short, original, friendly creature name and a kebab-case id. The folder party/<id>/ must not already exist (check with ls).
2. Research the repos above, read-only, only as much as needed to give the creature real, specific knowledge for its job: where the relevant code lives, conventions, gotchas, commands. Cite file paths.
3. Write party/<id>/brain/*.md: 2 to 4 dense notes with YAML frontmatter (title, tags, updated). Facts from code, not guesses; mark guesses as (inferred).
4. If the job needs a reusable procedure, write party/<id>/skills/<skill-name>/SKILL.md with frontmatter (name, description) and clear steps.
5. Write party/<id>/creature.yaml with exactly these keys:
   id, no (${nextNo}), name, role (under 6 words), blurb (1-2 sentences, user-facing), types (1-2 short uppercase tags),
   sprite (one of: ${BUILTIN_SPRITES.map((s) => BUILTIN_SPRITE_PREFIX + s).join(', ')}),
   engine (${request.engine}), autonomy (${request.autonomy}), cwd (the main repo path it works in, or the vault path),
   addDirs (other repo paths it needs), brain (list, normally ["brain/*.md"]), skills (names of global or local skills it should prefer),
   tools: { allow: [...], ask: [...], deny: [...] } using Claude Code permission rule syntax, least privilege for the job,
   learns: { into: "brain/", review: true }.
6. Do not touch any other creature's folder. Do not commit anything.
7. Finish with one short paragraph introducing the creature to the user.`;
};
