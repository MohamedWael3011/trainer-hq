import { execFileSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { AttachmentKind } from '@shared/constants';
import type { AttachmentInfoType } from '@shared/types';
import { appHome, expandHome } from './paths';

const SKILL_FILE = 'SKILL.md';
const ZIP_EXT = '.zip';
const SKIP_ENTRY = /(^|\/)(__MACOSX|\.DS_Store)/;
const SAFE_NAME = /[^a-z0-9-]+/g;
const MIN_DIR_DEPTH = 3;

const depth = (path: string): number => path.split('/').filter(Boolean).length;

const isBroadDir = (dir: string): boolean => dir === homedir() || depth(dir) < MIN_DIR_DEPTH;

const attachmentsHome = (): string => join(appHome(), 'attachments');

const zipEntries = (path: string): string[] =>
  execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !SKIP_ENTRY.test(line));

const extract = (zip: string, target: string): void => {
  mkdirSync(target, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', target]);
};

const findSkillDir = (root: string): string | undefined => {
  if (existsSync(join(root, SKILL_FILE))) return root;
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (!SKIP_ENTRY.test(name) && statSync(child).isDirectory()) {
      const found = findSkillDir(child);
      if (found) return found;
    }
  }
  return undefined;
};

const skillNameFrom = (skillDir: string, fallback: string): string => {
  const frontmatter = readFileSync(join(skillDir, SKILL_FILE), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const declared = frontmatter?.[1].match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1];
  return (declared ?? fallback).toLowerCase().replace(SAFE_NAME, '-').replace(/^-|-$/g, '') || 'skill';
};

export const inspectAttachment = (path: string): AttachmentInfoType => {
  const name = basename(path);
  if (!existsSync(path)) return { path, name, kind: AttachmentKind.FILE };
  if (statSync(path).isDirectory()) {
    const skillDir = findSkillDir(path);
    return skillDir
      ? { path, name, kind: AttachmentKind.SKILL, skillName: skillNameFrom(skillDir, basename(skillDir)) }
      : { path, name, kind: AttachmentKind.FOLDER };
  }
  if (extname(path).toLowerCase() !== ZIP_EXT) return { path, name, kind: AttachmentKind.FILE };
  const skillEntry = zipEntries(path).find((entry) => basename(entry) === SKILL_FILE);
  if (!skillEntry) return { path, name, kind: AttachmentKind.ZIP };
  const folder = dirname(skillEntry);
  return {
    path,
    name,
    kind: AttachmentKind.SKILL,
    skillName: (folder === '.' ? basename(path, ZIP_EXT) : basename(folder)).toLowerCase().replace(SAFE_NAME, '-'),
  };
};

const PATH_TOKEN = /"[^"]+"|'[^']+'|~?\/(?:\\ |[^\s"'`])+/g;

export const detectPaths = (text: string): string[] => {
  const tokens = text.match(PATH_TOKEN) ?? [];
  const paths = tokens
    .map((token) => token.replace(/^["']|["']$/g, '').replace(/\\ /g, ' ').replace(/[.,;:)]+$/, ''))
    .filter((token) => token.startsWith('/') || token.startsWith('~/'))
    .map((token) => expandHome(token))
    .filter((path) => existsSync(path) && !(statSync(path).isDirectory() && isBroadDir(path)));
  return Array.from(new Set(paths));
};

export type PreparedPathType = { source: string; target: string };

export const prepareAttachments = (paths: string[]): PreparedPathType[] => {
  if (paths.length === 0) return [];
  const batch = join(attachmentsHome(), randomUUID().slice(0, 8));
  return paths.filter((path) => existsSync(path)).map((path) => {
    if (statSync(path).isDirectory()) return { source: path, target: path };
    if (extname(path).toLowerCase() !== ZIP_EXT) {
      if (!isBroadDir(dirname(path))) return { source: path, target: path };
      mkdirSync(batch, { recursive: true });
      const copy = join(batch, basename(path));
      copyFileSync(path, copy);
      return { source: path, target: copy };
    }
    const target = join(batch, basename(path, ZIP_EXT));
    extract(path, target);
    return { source: path, target };
  });
};

export const attachmentDirs = (paths: string[]): string[] =>
  Array.from(new Set(paths.map((path) => (statSync(path).isDirectory() ? path : dirname(path)))));

export const installSkill = (source: string, skillsDir: string): string => {
  let root = source;
  let temp: string | undefined;
  if (!statSync(source).isDirectory()) {
    temp = join(attachmentsHome(), `skill-${randomUUID().slice(0, 8)}`);
    extract(source, temp);
    root = temp;
  }
  try {
    const skillDir = findSkillDir(root);
    if (!skillDir) throw new Error(`No ${SKILL_FILE} found in ${basename(source)}.`);
    const name = skillNameFrom(skillDir, basename(skillDir) === basename(root) ? basename(source, ZIP_EXT) : basename(skillDir));
    const target = join(skillsDir, name);
    mkdirSync(skillsDir, { recursive: true });
    cpSync(skillDir, target, { recursive: true, force: true });
    return name;
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
};

const PASTE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

// Pasted screenshots have no file on disk, so save them where a creature can read them.
export const savePastedFile = (data: ArrayBuffer, type: string): string => {
  const dir = join(appHome(), 'pastes');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `paste-${stamp}-${randomUUID().slice(0, 6)}${PASTE_EXT[type] ?? '.bin'}`);
  writeFileSync(path, Buffer.from(data));
  return path;
};

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// The API's per-image limit is 5 MB of base64, about 3.75 MB of file.
const MAX_INLINE_IMAGE_BYTES = 3_700_000;

// Images that can ride inside a message to a running Claude, like a pasted screenshot.
// Undefined when any path isn't such an image: that message has to wait for folder access.
export const inlineImages = (paths: string[]): { mediaType: string; data: string }[] | undefined => {
  const images = paths.map((path) => {
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mediaType || !existsSync(path) || statSync(path).size > MAX_INLINE_IMAGE_BYTES) return undefined;
    return { mediaType, data: readFileSync(path).toString('base64') };
  });
  return images.every((image) => image !== undefined) ? (images as { mediaType: string; data: string }[]) : undefined;
};
