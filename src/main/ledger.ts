import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CreatureType, CreatureUsageType, QuestUsageType, UsageReportType } from '@shared/types';
import { profileHome } from './paths';

const LEDGER_FILE = 'usage.json';
const KEEP_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const SAVE_DELAY_MS = 300;
export const REPORT_DAYS = 30;
export const BUDGET_DAYS = 7;

export type LedgerEntryType = {
  quests: number;
  handoffs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  compactions: number;
  freshSessions: number;
  coldResets: number;
};

export type LedgerRunType = {
  usage?: QuestUsageType;
  handoff: boolean;
  freshSession: boolean;
  coldReset: boolean;
};

type LedgerDaysType = Record<string, Record<string, LedgerEntryType>>;

const emptyEntry = (): LedgerEntryType => ({
  quests: 0,
  handoffs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  compactions: 0,
  freshSessions: 0,
  coldResets: 0,
});

const pad = (value: number): string => String(value).padStart(2, '0');

export const dayKey = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const lastDays = (count: number, now: number): string[] =>
  Array.from({ length: count }, (_unused, index) => dayKey(now - (count - 1 - index) * MS_PER_DAY));

const freshTokens = (entry: LedgerEntryType): number => entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens;

export class UsageLedger {
  private days: LedgerDaysType = {};
  private file = '';
  private saveTimer: NodeJS.Timeout | undefined;

  load(profileId: string): void {
    const dir = profileHome(profileId);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, LEDGER_FILE);
    try {
      this.days = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as LedgerDaysType) : {};
    } catch {
      this.days = {};
    }
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.file) writeFileSync(this.file, JSON.stringify(this.days));
    }, SAVE_DELAY_MS);
  }

  record(creatureId: string, run: LedgerRunType, at = Date.now()): void {
    const key = dayKey(at);
    const day = (this.days[key] ??= {});
    const entry = (day[creatureId] ??= emptyEntry());
    entry.quests += 1;
    if (run.handoff) entry.handoffs += 1;
    if (run.freshSession) entry.freshSessions += 1;
    if (run.coldReset) entry.coldResets += 1;
    if (run.usage) {
      entry.inputTokens += run.usage.inputTokens;
      entry.outputTokens += run.usage.outputTokens;
      entry.cacheReadTokens += run.usage.cacheReadTokens;
      entry.cacheWriteTokens += run.usage.cacheWriteTokens;
      entry.costUsd += run.usage.costUsd ?? 0;
      entry.compactions += run.usage.compactions ?? 0;
    }
    const oldest = dayKey(Date.now() - KEEP_DAYS * MS_PER_DAY);
    Object.keys(this.days).filter((name) => name < oldest).forEach((name) => delete this.days[name]);
    this.persist();
  }

  spentSince(creatureId: string, days: number, now = Date.now()): number {
    return lastDays(days, now).reduce((sum, key) => sum + (this.days[key]?.[creatureId]?.costUsd ?? 0), 0);
  }

  report(creatures: CreatureType[], days = REPORT_DAYS, now = Date.now()): UsageReportType {
    const keys = lastDays(days, now);
    const totals = new Map<string, LedgerEntryType>();
    const byDay = keys.map((key) => {
      const entries = Object.entries(this.days[key] ?? {});
      entries.forEach(([creatureId, entry]) => {
        const total = totals.get(creatureId) ?? emptyEntry();
        (Object.keys(total) as (keyof LedgerEntryType)[]).forEach((field) => { total[field] += entry[field]; });
        totals.set(creatureId, total);
      });
      return {
        day: key,
        costUsd: entries.reduce((sum, [, entry]) => sum + entry.costUsd, 0),
        tokens: entries.reduce((sum, [, entry]) => sum + freshTokens(entry) + entry.cacheReadTokens, 0),
      };
    });
    const budgets = new Map(creatures.map((creature) => [creature.id, creature.weeklyBudgetUsd]));
    const rows: CreatureUsageType[] = Array.from(new Set([...totals.keys(), ...creatures.filter((creature) => creature.weeklyBudgetUsd).map((creature) => creature.id)])).map((creatureId) => {
      const total = totals.get(creatureId) ?? emptyEntry();
      return {
        creatureId,
        quests: total.quests,
        handoffs: total.handoffs,
        freshTokens: freshTokens(total),
        cacheReadTokens: total.cacheReadTokens,
        costUsd: total.costUsd,
        compactions: total.compactions,
        freshSessions: total.freshSessions,
        coldResets: total.coldResets,
        weekCostUsd: this.spentSince(creatureId, BUDGET_DAYS, now),
        weeklyBudgetUsd: budgets.get(creatureId),
      };
    });
    return { days, creatures: rows.sort((a, b) => b.costUsd - a.costUsd || b.freshTokens - a.freshTokens), byDay };
  }
}
