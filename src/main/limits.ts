import type { UsageType } from '@shared/types';

const HOUR_MS = 3_600_000;
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
