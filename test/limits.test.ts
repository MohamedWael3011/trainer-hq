import { describe, expect, it } from 'vitest';
import { isUsageLimitText, limitResetAt } from '../src/main/limits';

const at = (hours: number, minutes = 0, dayOffset = 0): number => {
  const date = new Date(2026, 10, 12 + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
};

describe('limitResetAt', () => {
  const now = at(13, 10);

  it('prefers the reset from the latest rate-limit report', () => {
    const usage = { status: 'rejected', resetsAt: at(15), updatedAt: now };
    expect(limitResetAt(usage, 'resets 9pm', now)).toBe(at(15));
  });

  it('ignores a report whose reset already passed', () => {
    const usage = { status: 'rejected', resetsAt: at(12), updatedAt: now };
    expect(limitResetAt(usage, 'resets 3pm', now)).toBe(at(15));
  });

  it('reads the epoch form older CLIs print', () => {
    const reset = at(16, 30);
    expect(limitResetAt(undefined, `Claude AI usage limit reached|${Math.floor(reset / 1000)}`, now)).toBe(reset);
  });

  it('reads clock times with minutes and am/pm', () => {
    expect(limitResetAt(undefined, "You've hit your limit · resets 3:30pm (Africa/Cairo)", now)).toBe(at(15, 30));
    expect(limitResetAt(undefined, 'limit reached, resets 12am', now)).toBe(at(0, 0, 1));
  });

  it('rolls a time earlier than now over to tomorrow', () => {
    expect(limitResetAt(undefined, 'resets 9am', now)).toBe(at(9, 0, 1));
  });

  it('gives up when nothing says when', () => {
    expect(limitResetAt(undefined, 'usage limit reached', now)).toBeUndefined();
  });
});

describe('isUsageLimitText', () => {
  it('recognises every wording the CLI has used for a plan limit', () => {
    expect(isUsageLimitText("You've hit your 5-hour limit · resets 8:10pm (Africa/Cairo)")).toBe(true);
    expect(isUsageLimitText("You've hit your limit · resets 3pm")).toBe(true);
    expect(isUsageLimitText("You've hit your weekly limit · resets Mon 9am")).toBe(true);
    expect(isUsageLimitText('Claude AI usage limit reached|1731430800')).toBe(true);
    expect(isUsageLimitText('The file exceeds the size limit of 256 KB')).toBe(false);
  });
});
