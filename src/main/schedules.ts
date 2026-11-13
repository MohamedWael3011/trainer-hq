import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ScheduleCadence, type ScheduleCadenceType } from '@shared/constants';
import type { ScheduleSaveRequestType, ScheduleType } from '@shared/types';
import { profileHome } from './paths';

const SCHEDULES_FILE = 'schedules.json';
const MS_PER_HOUR = 3_600_000;
const SATURDAY = 6;
const SUNDAY = 0;
const SEARCH_DAYS = 8;
const CADENCES = Object.values(ScheduleCadence) as string[];

const clampInt = (value: unknown, min: number, max: number): number => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
};

const isWeekend = (date: Date): boolean => date.getDay() === SATURDAY || date.getDay() === SUNDAY;

export const nextRun = (schedule: Pick<ScheduleType, 'cadence' | 'hour' | 'minute' | 'weekday'>, after: number): number => {
  if (schedule.cadence === ScheduleCadence.HOURLY) {
    const slot = new Date(after);
    slot.setMinutes(schedule.minute, 0, 0);
    return slot.getTime() > after ? slot.getTime() : slot.getTime() + MS_PER_HOUR;
  }
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const slot = new Date(after);
    slot.setDate(slot.getDate() + offset);
    slot.setHours(schedule.hour, schedule.minute, 0, 0);
    if (slot.getTime() <= after) continue;
    if (schedule.cadence === ScheduleCadence.WEEKDAYS && isWeekend(slot)) continue;
    if (schedule.cadence === ScheduleCadence.WEEKLY && slot.getDay() !== schedule.weekday) continue;
    return slot.getTime();
  }
  return after + MS_PER_HOUR;
};

export class ScheduleStore {
  private schedules: ScheduleType[] = [];
  private file = '';

  load(profileId: string): void {
    const dir = profileHome(profileId);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, SCHEDULES_FILE);
    try {
      this.schedules = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as ScheduleType[]) : [];
    } catch {
      this.schedules = [];
    }
  }

  private persist(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.schedules, null, 2));
  }

  list(): ScheduleType[] {
    return this.schedules;
  }

  get(id: string): ScheduleType | undefined {
    return this.schedules.find((schedule) => schedule.id === id);
  }

  save(request: ScheduleSaveRequestType, now = Date.now()): string {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error('Write what the creature should do.');
    const cadence: ScheduleCadenceType = CADENCES.includes(request.cadence) ? request.cadence : ScheduleCadence.DAILY;
    const timing = {
      cadence,
      hour: clampInt(request.hour, 0, 23),
      minute: clampInt(request.minute, 0, 59),
      weekday: clampInt(request.weekday, 0, 6),
    };
    const existing = request.id ? this.get(request.id) : undefined;
    const schedule: ScheduleType = {
      id: existing?.id ?? randomUUID().slice(0, 8),
      creatureId: request.creatureId,
      threadId: request.threadId,
      prompt,
      ...timing,
      enabled: request.enabled,
      lastRunAt: existing?.lastRunAt,
      nextRunAt: nextRun(timing, now),
    };
    this.schedules = existing ? this.schedules.map((entry) => (entry.id === schedule.id ? schedule : entry)) : [...this.schedules, schedule];
    this.persist();
    return schedule.id;
  }

  setThread(id: string, threadId: string): void {
    const schedule = this.get(id);
    if (!schedule) return;
    schedule.threadId = threadId;
    this.persist();
  }

  remove(id: string): void {
    this.schedules = this.schedules.filter((schedule) => schedule.id !== id);
    this.persist();
  }

  due(now = Date.now()): ScheduleType[] {
    return this.schedules.filter((schedule) => schedule.enabled && schedule.nextRunAt <= now);
  }

  markRan(id: string, now = Date.now()): void {
    const schedule = this.get(id);
    if (!schedule) return;
    schedule.lastRunAt = now;
    schedule.nextRunAt = nextRun(schedule, now);
    this.persist();
  }
}
