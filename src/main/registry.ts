import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import chokidar from 'chokidar';
import YAML from 'yaml';
import { Autonomy, BUILTIN_SPRITE_PREFIX, DEFAULT_SPRITE, type AutonomyType } from '@shared/constants';
import type { CreatureType } from '@shared/types';
import { expandHome } from './paths';

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const PARTY_DIR = 'party';
const CREATURE_FILE = 'creature.yaml';
const DEFAULT_BRAIN = ['brain/*.md'];
const WATCH_DEBOUNCE_MS = 250;
const AUTONOMY_VALUES = Object.values(Autonomy) as string[];

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const toAutonomy = (value: unknown): AutonomyType =>
  AUTONOMY_VALUES.includes(String(value)) ? (value as AutonomyType) : Autonomy.ASK;

export const expandGlob = (pattern: string, base: string): string[] => {
  const full = expandHome(pattern, base);
  if (!full.includes('*')) return existsSync(full) ? [full] : [];
  const dir = dirname(full);
  if (!existsSync(dir)) return [];
  const matcher = new RegExp(`^${basename(full).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return readdirSync(dir)
    .filter((name) => matcher.test(name))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .sort();
};

const parseCreature = (dir: string, index: number): CreatureType | null => {
  const file = join(dir, CREATURE_FILE);
  if (!existsSync(file)) return null;
  const data = (YAML.parse(readFileSync(file, 'utf8')) ?? {}) as Record<string, any>;
  const tools = (data.tools ?? {}) as Record<string, unknown>;
  const learns = (data.learns ?? {}) as Record<string, unknown>;
  const id = typeof data.id === 'string' ? data.id : basename(dir);
  return {
    id,
    no: typeof data.no === 'number' ? data.no : index + 1,
    name: typeof data.name === 'string' ? data.name : id,
    role: typeof data.role === 'string' ? data.role : '',
    blurb: typeof data.blurb === 'string' ? data.blurb : '',
    types: strings(data.types),
    sprite: typeof data.sprite === 'string' ? data.sprite : `${BUILTIN_SPRITE_PREFIX}${DEFAULT_SPRITE}`,
    engine: typeof data.engine === 'string' ? data.engine : 'claude',
    model: typeof data.model === 'string' ? data.model : undefined,
    effort: typeof data.effort === 'string' && EFFORTS.has(data.effort) ? data.effort : undefined,
    cwd: typeof data.cwd === 'string' ? expandHome(data.cwd, dir) : undefined,
    addDirs: strings(data.addDirs).map((path) => expandHome(path, dir)),
    brain: data.brain ? strings(data.brain) : DEFAULT_BRAIN,
    skills: strings(data.skills),
    tools: { allow: strings(tools.allow), ask: strings(tools.ask), deny: strings(tools.deny) },
    autonomy: toAutonomy(data.autonomy),
    learnsInto: typeof learns.into === 'string' ? learns.into : 'brain/',
    learnsReview: learns.review !== false,
    dir,
  };
};

export const loadCreatures = (vault: string): { creatures: CreatureType[]; errors: string[] } => {
  const partyDir = join(vault, PARTY_DIR);
  const errors: string[] = [];
  if (!existsSync(partyDir)) return { creatures: [], errors };
  const dirs = readdirSync(partyDir)
    .map((name) => join(partyDir, name))
    .filter((path) => statSync(path).isDirectory())
    .sort();
  const creatures: CreatureType[] = [];
  dirs.forEach((dir, index) => {
    try {
      const creature = parseCreature(dir, index);
      if (creature) creatures.push(creature);
    } catch (error) {
      errors.push(`${basename(dir)}/${CREATURE_FILE}: ${(error as Error).message}`);
    }
  });
  return { creatures: creatures.sort((a, b) => a.no - b.no), errors };
};

export const updateCreatureFile = (creature: CreatureType, patch: Record<string, unknown>): void => {
  const file = join(creature.dir, CREATURE_FILE);
  const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
  Object.entries(patch).forEach(([key, value]) => (value === undefined ? doc.delete(key) : doc.set(key, value)));
  writeFileSync(file, doc.toString());
};

export const watchVault = (vault: string, onChange: () => void): (() => void) => {
  let timer: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(
    [join(vault, PARTY_DIR), join(vault, 'daycare', 'inbox'), join(vault, 'profile.yaml'), join(vault, 'sprites')],
    { ignoreInitial: true, depth: 3 },
  );
  watcher.on('all', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    void watcher.close();
  };
};
