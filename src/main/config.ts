import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import YAML from 'yaml';
import { EngineAdapter, type EngineAdapterType } from '@shared/constants';
import { appHome, expandHome, vaultTemplateDir } from './paths';

export type EngineConfigType = {
  adapter: EngineAdapterType;
  bin: string;
  args: string[];
};

export type GuardConfigType = {
  fullAutoMaxMinutes: number;
  fullAutoMaxPlanUsage: number;
  fullAutoWorktree: boolean;
  alwaysDeny: string[];
};

export type LabConfigType = {
  title: string;
  home: string;
  skill: string;
  examples: string;
  markerFile: string;
  refFile: string;
  serverScript: string;
  readyPath: string;
  port: number;
  now: string;
  tz: string;
};

export type ProfileConfigType = {
  name: string;
  vault: string;
  claudeConfigDir?: string;
  repos: Record<string, string>;
  engines: Record<string, EngineConfigType>;
  guard: GuardConfigType;
  daycareAutoPropose: boolean;
  daycareAutoApproveFullAuto: boolean;
  spriteOverrides: string;
  env: Record<string, string>;
  lab?: LabConfigType;
};

type ProfilesFileType = {
  active: string;
  profiles: Record<string, { vault: string }>;
};

const PROFILES_FILE = 'profiles.yaml';
const PROFILE_FILE = 'profile.yaml';
const DEFAULT_PROFILE_ID = 'main';
const DEFAULT_VAULT = '~/Documents/trainer-hq-vault';
const DEFAULT_ENGINE = 'claude';
const DEFAULT_OVERRIDES = 'sprites/overrides';

export const DEFAULT_ALWAYS_DENY = [
  'Bash(git push:*)',
  'Bash(git push)',
  'Bash(git reset --hard:*)',
  'Bash(git clean:*)',
  'Bash(git merge:*)',
  'Bash(git rebase:*)',
  'Bash(rm -rf:*)',
  'Bash(sudo:*)',
  'Read(**/.env)',
  'Read(**/.env.*)',
];

const profilesPath = (): string => join(appHome(), PROFILES_FILE);

const DEFAULT_CLAUDE_DIR = join(homedir(), '.claude');

const customClaudeDir = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const dir = expandHome(value.trim());
  return resolve(dir) === resolve(DEFAULT_CLAUDE_DIR) ? undefined : dir;
};

const seedVault = (vault: string): void => {
  if (existsSync(join(vault, PROFILE_FILE))) return;
  mkdirSync(vault, { recursive: true });
  const template = vaultTemplateDir();
  if (existsSync(template)) cpSync(template, vault, { recursive: true, force: false, errorOnExist: false });
};

export const loadProfiles = (): ProfilesFileType => {
  mkdirSync(appHome(), { recursive: true });
  if (!existsSync(profilesPath())) {
    const initial: ProfilesFileType = {
      active: DEFAULT_PROFILE_ID,
      profiles: { [DEFAULT_PROFILE_ID]: { vault: DEFAULT_VAULT } },
    };
    writeFileSync(profilesPath(), YAML.stringify(initial));
    seedVault(expandHome(DEFAULT_VAULT));
    return initial;
  }
  const parsed = YAML.parse(readFileSync(profilesPath(), 'utf8')) as Partial<ProfilesFileType> | null;
  const profiles = parsed?.profiles && Object.keys(parsed.profiles).length > 0
    ? parsed.profiles
    : { [DEFAULT_PROFILE_ID]: { vault: DEFAULT_VAULT } };
  const active = parsed?.active && profiles[parsed.active] ? parsed.active : Object.keys(profiles)[0];
  return { active, profiles };
};

const SLUG = /[^a-z0-9]+/g;

export const addProfile = (name: string, vaultSetting: string, claudeConfigDir?: string): string => {
  const current = loadProfiles();
  const base = name.toLowerCase().replace(SLUG, '-').replace(/^-|-$/g, '') || 'profile';
  let id = base;
  let suffix = 2;
  while (current.profiles[id]) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  const vault = expandHome(vaultSetting);
  seedVault(vault);
  const file = join(vault, PROFILE_FILE);
  const doc = YAML.parseDocument(existsSync(file) ? readFileSync(file, 'utf8') : '');
  doc.set('name', name);
  if (customClaudeDir(claudeConfigDir)) doc.set('claudeConfigDir', claudeConfigDir);
  writeFileSync(file, doc.toString());
  writeFileSync(profilesPath(), YAML.stringify({ active: id, profiles: { ...current.profiles, [id]: { vault: vaultSetting } } }));
  return id;
};

export const setActiveProfile = (profileId: string): void => {
  const current = loadProfiles();
  if (!current.profiles[profileId]) return;
  writeFileSync(profilesPath(), YAML.stringify({ ...current, active: profileId }));
};

const toEngine = (value: unknown): EngineConfigType | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const adapter = raw.adapter === EngineAdapter.CLAUDE ? EngineAdapter.CLAUDE : EngineAdapter.CLI;
  const bin = typeof raw.bin === 'string' ? raw.bin : DEFAULT_ENGINE;
  const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
  return { adapter, bin, args };
};

const toLab = (value: unknown, vault: string): LabConfigType | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.enabled === false || typeof raw.home !== 'string' || typeof raw.skill !== 'string') return undefined;
  const text = (key: string, fallback: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : fallback);
  const clock = (raw.clock ?? {}) as Record<string, unknown>;
  return {
    title: text('title', 'Lab'),
    home: expandHome(raw.home, vault),
    skill: expandHome(raw.skill, vault),
    examples: text('examples', 'examples'),
    markerFile: text('markerFile', '.render-commit'),
    refFile: text('refFile', '.render-ref'),
    serverScript: text('serverScript', 'app/harness/bin/restart_server.sh'),
    readyPath: text('readyPath', 'app/node_modules'),
    port: Number(raw.port) > 0 ? Number(raw.port) : 8787,
    now: typeof clock.now === 'string' ? clock.now : '',
    tz: typeof clock.tz === 'string' ? clock.tz : '',
  };
};

export const loadProfileConfig = (vaultSetting: string): ProfileConfigType => {
  const vault = expandHome(vaultSetting);
  seedVault(vault);
  const file = join(vault, PROFILE_FILE);
  const raw = (existsSync(file) ? YAML.parse(readFileSync(file, 'utf8')) : {}) as Record<string, any> | null;
  const data = raw ?? {};
  const engines: Record<string, EngineConfigType> = {
    [DEFAULT_ENGINE]: { adapter: EngineAdapter.CLAUDE, bin: DEFAULT_ENGINE, args: [] },
  };
  Object.entries((data.engines ?? {}) as Record<string, unknown>).forEach(([name, value]) => {
    const engine = toEngine(value);
    if (engine) engines[name] = engine;
  });
  const repos: Record<string, string> = {};
  Object.entries((data.repos ?? {}) as Record<string, unknown>).forEach(([name, path]) => {
    if (typeof path === 'string') repos[name] = expandHome(path);
  });
  const guard = (data.guard ?? {}) as Record<string, any>;
  const fullAuto = (guard.fullAuto ?? {}) as Record<string, any>;
  const daycare = (data.daycare ?? {}) as Record<string, any>;
  return {
    name: typeof data.name === 'string' ? data.name : 'Trainer',
    vault,
    claudeConfigDir: customClaudeDir(data.claudeConfigDir),
    repos,
    engines,
    guard: {
      fullAutoMaxMinutes: Number(fullAuto.maxMinutes) > 0 ? Number(fullAuto.maxMinutes) : 45,
      fullAutoMaxPlanUsage: Number(fullAuto.maxPlanUsage) > 0 ? Number(fullAuto.maxPlanUsage) : 0.85,
      fullAutoWorktree: fullAuto.worktree !== false,
      alwaysDeny: [...DEFAULT_ALWAYS_DENY, ...((guard.alwaysDeny ?? []) as string[])],
    },
    daycareAutoPropose: daycare.autoPropose !== false,
    daycareAutoApproveFullAuto: daycare.autoApproveFullAuto === true,
    spriteOverrides: join(vault, typeof data.spriteOverrides === 'string' ? data.spriteOverrides : DEFAULT_OVERRIDES),
    lab: toLab(data.lab, vault),
    env: Object.fromEntries(Object.entries((data.env ?? {}) as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' ? expandHome(value) : String(value)])),
  };
};
