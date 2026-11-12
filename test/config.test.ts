import { describe, expect, it } from 'vitest';
import { toSession } from '../src/main/config';

describe('session config', () => {
  it('uses token-saving defaults when profile.yaml has no session block', () => {
    expect(toSession(undefined)).toEqual({ autocompactTokens: 200_000, idleResetMinutes: 60, idleResetMinTokens: 40_000, fallbackModel: 'sonnet' });
  });

  it('clamps autocompact to what the CLI accepts', () => {
    expect(toSession({ autocompact: 50_000 }).autocompactTokens).toBe(100_000);
    expect(toSession({ autocompact: 5_000_000 }).autocompactTokens).toBe(1_000_000);
  });

  it('lets users hand compaction back to the CLI and turn features off', () => {
    const session = toSession({ autocompact: 'auto', idleResetMinutes: 0, fallbackModel: '' });
    expect(session.autocompactTokens).toBe(0);
    expect(session.idleResetMinutes).toBe(0);
    expect(session.fallbackModel).toBe('');
  });
});
