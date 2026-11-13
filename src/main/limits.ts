import type { UsageType } from '@shared/types';

const HOUR_MS = 3_600_000;
const USAGE_LIMIT_PATTERN = /usage limit|rate limit|limit reached|reset at|hit your (?:[\w-]+ )*limit|limit\s*·\s*resets/i;

export const isUsageLimitText = (text: string): boolean => USAGE_LIMIT_PATTERN.test(text);
const DAY_MS = 24 * HOUR_MS;
// Older CLIs end the error with the reset as epoch seconds: "Claude AI usage limit reached|1731430800".
const EPOCH_PATTERN = /\|(\d{10})\b/;
// Newer ones say it in words: "You've hit your limit · resets 3pm (Africa/Cairo)" or "resets 3:30pm".
const CLOCK_PATTERN = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

// The next time the given local clock time comes around, today or tomorrow.
const nextClockTime = (hours: number, minutes: number, now: number): number => {
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  return at.getTime() > now ? at.getTime() : at.getTime() + DAY_MS;
};

const parseClock = (text: string, now: number): number | undefined => {
  const match = text.match(CLOCK_PATTERN);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return nextClockTime(hours, minutes, now);
};

// When a plan usage limit lifts: from Claude Code's latest rate-limit report if it is still
// ahead, otherwise from the error text. Undefined when neither says, so nothing is guessed.
export const limitResetAt = (usage: UsageType | undefined, errorText: string | undefined, now = Date.now()): number | undefined => {
  if (usage?.resetsAt && usage.resetsAt > now) return usage.resetsAt;
  const text = errorText ?? '';
  const epoch = text.match(EPOCH_PATTERN);
  if (epoch) {
    const at = Number(epoch[1]) * 1000;
    if (at > now) return at;
  }
  return parseClock(text, now);
};

export type UsageSampleType = { at: number; fiveHour: number };

const FORECAST_LOOKBACK_MS = 45 * 60_000;
const FORECAST_MIN_SPAN_MS = 10 * 60_000;
const FORECAST_HORIZON_MS = 5 * HOUR_MS;

// When the 5-hour window runs out at the pace of the last 45 minutes. Undefined when there is too
// little to go on, usage isn't climbing, or the window resets first.
export const forecastLimitAt = (samples: UsageSampleType[], resetsAt: number | undefined, now = Date.now()): number | undefined => {
  const recent = samples.filter((sample) => now - sample.at <= FORECAST_LOOKBACK_MS);
  if (recent.length < 2) return undefined;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = last.at - first.at;
  const climb = last.fiveHour - first.fiveHour;
  if (span < FORECAST_MIN_SPAN_MS || climb <= 0 || last.fiveHour >= 1) return undefined;
  const hitsAt = last.at + ((1 - last.fiveHour) / climb) * span;
  const until = resetsAt && resetsAt > now ? resetsAt : now + FORECAST_HORIZON_MS;
  return hitsAt < until ? Math.max(hitsAt, now) : undefined;
};
