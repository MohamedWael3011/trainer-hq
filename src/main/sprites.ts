import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { pathToFileURL } from 'url';
import { net, protocol } from 'electron';
import { BUILTIN_SPRITE_PREFIX, DEFAULT_SPRITE, SPRITE_ALIASES, SPRITE_PROTOCOL } from '@shared/constants';
import type { CreatureType } from '@shared/types';
import { expandHome, resourcesDir } from './paths';

const OVERRIDE_EXTENSIONS = ['.gif', '.png', '.webp'];

export const overrideFor = (overridesDir: string, id: string): string | undefined =>
  OVERRIDE_EXTENSIONS.map((ext) => join(overridesDir, `${id}${ext}`)).find((path) => existsSync(path));

const builtinPath = (name: string): string => join(resourcesDir(), 'sprites', `${name}.png`);

export const resolveSprite = (id: string, creatures: CreatureType[], overridesDir: string): string => {
  const override = overrideFor(overridesDir, id);
  if (override) return override;
  const creature = creatures.find((entry) => entry.id === id);
  const sprite = creature?.sprite ?? `${BUILTIN_SPRITE_PREFIX}${SPRITE_ALIASES[id] ?? id}`;
  if (sprite.startsWith(BUILTIN_SPRITE_PREFIX)) {
    const path = builtinPath(sprite.slice(BUILTIN_SPRITE_PREFIX.length));
    return existsSync(path) ? path : builtinPath(DEFAULT_SPRITE);
  }
  const custom = creature ? expandHome(sprite, creature.dir) : '';
  return custom && existsSync(custom) ? custom : builtinPath(DEFAULT_SPRITE);
};

export const registerSpriteProtocol = (resolve: (id: string) => string): void => {
  protocol.handle(SPRITE_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return net.fetch(pathToFileURL(resolve(id)).toString());
  });
};

export const setOverride = (overridesDir: string, id: string, source: string): void => {
  const ext = extname(source).toLowerCase();
  if (!OVERRIDE_EXTENSIONS.includes(ext)) throw new Error(`Use a PNG, GIF or WebP file (got ${ext || 'no extension'}).`);
  mkdirSync(overridesDir, { recursive: true });
  clearOverride(overridesDir, id);
  copyFileSync(source, join(overridesDir, `${id}${ext}`));
};

export const clearOverride = (overridesDir: string, id: string): void => {
  OVERRIDE_EXTENSIONS.forEach((ext) => {
    const path = join(overridesDir, `${id}${ext}`);
    if (existsSync(path)) unlinkSync(path);
  });
};
