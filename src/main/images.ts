import { createHash } from 'crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { nativeImage } from 'electron';
import { appHome } from './paths';

const MAX_EDGE_PX = 1568;
const JPEG_QUALITY = 85;
const SCALED_DIR = 'scaled';
const ATTACHMENTS_DIR = 'attachments';
const JPEG_EXTS = new Set(['.jpg', '.jpeg']);
const SCALABLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export const downscaleImage = (path: string): string => {
  const ext = extname(path).toLowerCase();
  if (!SCALABLE_EXTS.has(ext) || !existsSync(path)) return path;
  try {
    const image = nativeImage.createFromPath(path);
    const { width, height } = image.getSize();
    if (image.isEmpty() || Math.max(width, height) <= MAX_EDGE_PX) return path;
    const stat = statSync(path);
    const tag = createHash('sha1').update(`${path}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 10);
    const jpeg = JPEG_EXTS.has(ext);
    const dir = join(appHome(), ATTACHMENTS_DIR, SCALED_DIR);
    const target = join(dir, `${basename(path, ext)}-${tag}${jpeg ? '.jpg' : '.png'}`);
    if (existsSync(target)) return target;
    const resized = width >= height ? image.resize({ width: MAX_EDGE_PX, quality: 'best' }) : image.resize({ height: MAX_EDGE_PX, quality: 'best' });
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, jpeg ? resized.toJPEG(JPEG_QUALITY) : resized.toPNG());
    return target;
  } catch {
    return path;
  }
};
