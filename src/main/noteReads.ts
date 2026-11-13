import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { NoteFlag, type NoteFlagType } from '@shared/constants';
import type { BrainHealthType } from '@shared/types';
import { profileHome } from './paths';

const READS_FILE = 'note-reads.json';
const NOTE_EXT = '.md';
const SAVE_DELAY_MS = 500;
const MS_PER_DAY = 86_400_000;
const NEVER_READ_AFTER_DAYS = 7;
const STALE_AFTER_DAYS = 90;
const LARGE_NOTE_BYTES = 20_000;

type ReadEntryType = { count: number; lastAt: number };
type ReadsFileType = { since: number; reads: Record<string, ReadEntryType> };

export class NoteReadLog {
  private data: ReadsFileType = { since: Date.now(), reads: {} };
  private file = '';
  private saveTimer: NodeJS.Timeout | undefined;

  load(profileId: string): void {
    const dir = profileHome(profileId);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, READS_FILE);
    try {
      this.data = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as ReadsFileType) : { since: Date.now(), reads: {} };
    } catch {
      this.data = { since: Date.now(), reads: {} };
    }
  }

  record(path: string, now = Date.now()): void {
    if (!path.endsWith(NOTE_EXT)) return;
    const entry = (this.data.reads[path] ??= { count: 0, lastAt: now });
    entry.count += 1;
    entry.lastAt = now;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.file) writeFileSync(this.file, JSON.stringify(this.data));
    }, SAVE_DELAY_MS);
  }

  health(files: string[], inlined: string[], vault: string, now = Date.now()): BrainHealthType {
    const always = new Set(inlined);
    const tracked = now - this.data.since >= NEVER_READ_AFTER_DAYS * MS_PER_DAY;
    const notes = files.filter((file) => existsSync(file)).map((file) => {
      const stat = statSync(file);
      const read = this.data.reads[file];
      const flags: NoteFlagType[] = [];
      if (always.has(file)) flags.push(NoteFlag.INLINE);
      else if (!read && tracked) flags.push(NoteFlag.NEVER_READ);
      if (stat.size >= LARGE_NOTE_BYTES) flags.push(NoteFlag.LARGE);
      if (now - stat.mtimeMs >= STALE_AFTER_DAYS * MS_PER_DAY) flags.push(NoteFlag.STALE);
      return { path: file, label: relative(vault, file), bytes: stat.size, updatedAt: stat.mtimeMs, reads: read?.count ?? 0, lastReadAt: read?.lastAt, flags };
    });
    return { trackedSince: this.data.since, notes: notes.sort((a, b) => b.bytes - a.bytes) };
  }
}
