import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, relative } from 'path';
import YAML from 'yaml';
import type { CommandInfoType } from '@shared/types';

const DESCRIPTION_LIMIT = 220;
const PLUGIN_DEPTH = 7;
const CACHE_MS = 60_000;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

// Built into Claude Code, so there's no file to read a description from.
const BUILTIN: Record<string, string> = {
  compact: 'Summarize the conversation so far to free up context. Keeps the thread, costs less per step.',
  context: 'Show what is filling the context window.',
  cost: 'Show token use and cost for this session.',
  init: 'Write a CLAUDE.md that explains this codebase.',
  review: 'Review a pull request.',
  'security-review': 'Security review of the pending changes on this branch.',
  'pr-comments': 'Fetch the comments on a GitHub pull request.',
  'release-notes': 'Show Claude Code release notes.',
  'code-review': 'Review the current changes (or a PR) for bugs.',
  simplify: 'Clean up the changed code: reuse, simplification, efficiency.',
  debug: 'Track down the cause of a bug step by step.',
  verify: 'Check that a change actually works.',
  run: 'Launch the project and see a change working.',
  loop: 'Run a prompt or command on a recurring interval.',
  schedule: 'Create or manage scheduled cloud agents.',
  batch: 'Apply one change across many files or items.',
  'claude-api': 'Reference for building with the Claude API and SDKs.',
  'update-config': 'Change Claude Code settings, permissions and hooks.',
  'fewer-permission-prompts': 'Allowlist common read-only commands to cut permission prompts.',
};

type FoundType = { description: string; kind: CommandInfoType['kind'] };

const frontmatter = (file: string): Record<string, unknown> => {
  try {
    const match = readFileSync(file, 'utf8').match(FRONTMATTER);
    return match ? ((YAML.parse(match[1]) ?? {}) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const clip = (text: unknown): string => {
  const flat = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT)}…` : flat;
};

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isDirectory());
  } catch {
    return [];
  }
};

// Skills and commands under one .claude-style folder; `prefix` namespaces a plugin's entries.
const scanBase = (base: string, index: Map<string, FoundType>, prefix = ''): void => {
  const skills = join(base, 'skills');
  listDirs(skills).forEach((dir) => {
    const file = join(skills, dir, 'SKILL.md');
    if (!existsSync(file)) return;
    const meta = frontmatter(file);
    const name = typeof meta.name === 'string' ? meta.name : dir;
    const found = { description: clip(meta.description), kind: 'skill' as const };
    index.set(`${prefix}${name}`, found);
    if (prefix && !index.has(name)) index.set(name, found);
  });
  const commands = join(base, 'commands');
  const walk = (dir: string): void => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    names.forEach((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md')) {
        const id = relative(commands, full).replace(/\.md$/, '').split('/').join(':');
        index.set(`${prefix}${id}`, { description: clip(frontmatter(full).description), kind: 'command' });
      }
    });
  };
  walk(commands);
};

// Installed plugins: each has a .claude-plugin/plugin.json naming it, plus skills/ and commands/.
const scanPlugins = (dir: string, index: Map<string, FoundType>, depth = 0): void => {
  if (depth > PLUGIN_DEPTH || !existsSync(dir)) return;
  const manifest = join(dir, '.claude-plugin', 'plugin.json');
  if (existsSync(manifest)) {
    let name = basename(dir);
    try {
      name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ?? name;
    } catch {
      // Keep the folder name.
    }
    scanBase(dir, index, `${name}:`);
    return;
  }
  listDirs(dir).forEach((child) => scanPlugins(join(dir, child), index, depth + 1));
};

let cached: { key: string; at: number; index: Map<string, FoundType> } | undefined;

const buildIndex = (projectDirs: string[], configDir: string): Map<string, FoundType> => {
  const key = [configDir, ...projectDirs].join('|');
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.index;
  const index = new Map<string, FoundType>();
  scanPlugins(join(configDir, 'plugins'), index);
  scanBase(configDir, index);
  // Project entries win over personal ones with the same name, as in Claude Code.
  projectDirs.forEach((dir) => scanBase(join(dir, '.claude'), index));
  cached = { key, at: Date.now(), index };
  return index;
};

// What each slash command and skill does. `names` is what Claude Code reported it can run
// (its init message); without that, everything found on disk plus the common built-ins.
export const describeCommands = (names: string[] | undefined, projectDirs: string[], configDir: string): CommandInfoType[] => {
  const index = buildIndex(projectDirs, configDir);
  const all = names ?? Array.from(new Set([...index.keys(), ...Object.keys(BUILTIN)]));
  return all
    .map((name) => {
      const found = index.get(name);
      if (found) return { name, description: found.description, kind: found.kind };
      if (BUILTIN[name]) return { name, description: BUILTIN[name], kind: 'builtin' as const };
      return { name, description: '', kind: 'builtin' as const };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};
