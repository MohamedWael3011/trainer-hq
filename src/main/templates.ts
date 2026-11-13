import { cpSync, existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import YAML from 'yaml';
import { CommandKind } from '@shared/constants';
import type { CommandInfoType } from '@shared/types';
import { vaultTemplateDir } from './paths';

const TEMPLATES_DIR = 'templates';
const TEMPLATE_EXT = '.md';
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const seedTemplates = (vault: string): void => {
  const target = join(vault, TEMPLATES_DIR);
  const source = join(vaultTemplateDir(), TEMPLATES_DIR);
  if (existsSync(target) || !existsSync(source)) return;
  try {
    cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
  } catch {
    return;
  }
};

export const listTemplates = (vault: string): CommandInfoType[] => {
  const dir = join(vault, TEMPLATES_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(TEMPLATE_EXT))
      .sort()
      .map((name) => {
        const raw = readFileSync(join(dir, name), 'utf8');
        const match = raw.match(FRONTMATTER);
        let description = '';
        if (match) {
          try {
            const meta = (YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
            description = typeof meta.description === 'string' ? meta.description : '';
          } catch {
            description = '';
          }
        }
        return { name: basename(name, TEMPLATE_EXT), description, kind: CommandKind.TEMPLATE, prompt: (match ? match[2] : raw).trim() };
      })
      .filter((template) => template.prompt.length > 0);
  } catch {
    return [];
  }
};
