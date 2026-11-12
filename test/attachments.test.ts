import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { inlineImages } from '../src/main/attachments';

const dir = mkdtempSync(join(tmpdir(), 'thq-attach-'));
const file = (name: string, bytes: number): string => {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(bytes, 1));
  return path;
};

describe('inlineImages', () => {
  it('reads screenshots as base64 images', () => {
    const images = inlineImages([file('shot.png', 10), file('photo.JPG', 10)]);
    expect(images?.map((image) => image.mediaType)).toEqual(['image/png', 'image/jpeg']);
    expect(images?.[0].data).toBe(Buffer.alloc(10, 1).toString('base64'));
  });

  it('has nothing to inline for a plain message', () => {
    expect(inlineImages([])).toEqual([]);
  });

  it('refuses when any file is not an image or is too big', () => {
    expect(inlineImages([file('shot2.png', 10), file('notes.pdf', 10)])).toBeUndefined();
    expect(inlineImages([file('huge.png', 4_000_000)])).toBeUndefined();
  });
});
