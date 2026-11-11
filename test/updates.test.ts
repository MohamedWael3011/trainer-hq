import { describe, expect, it } from 'vitest';
import { checkForUpdate, githubRepo } from '../src/main/updates';

const respond = (status: number, body: unknown) => (async () => ({ ok: status === 200, status, json: async () => body })) as unknown as typeof fetch;

describe('githubRepo', () => {
  it('reads owner/name from https and ssh remotes', () => {
    expect(githubRepo('https://github.com/MohamedWael3011/trainer-hq.git')).toBe('MohamedWael3011/trainer-hq');
    expect(githubRepo('git@github.com:someone/trainer-hq.git')).toBe('someone/trainer-hq');
    expect(githubRepo('https://gitlab.com/x/y.git')).toBe('');
  });
});

describe('checkForUpdate', () => {
  it('reports how many commits the branch is ahead of this build', async () => {
    let asked = '';
    const fetcher = (async (url: string) => {
      asked = url;
      return { ok: true, status: 200, json: async () => ({ status: 'ahead', ahead_by: 3, html_url: 'https://github.com/owner/trainer-hq/compare/x', commits: [{ sha: 'b1' }, { sha: 'c2', commit: { message: 'Fix notch clicks\n\nbody' } }] }) };
    }) as unknown as typeof fetch;
    const update = await checkForUpdate(fetcher);
    expect(asked).toBe('https://api.github.com/repos/owner/trainer-hq/compare/aaaa111...main');
    expect(update).toEqual({ behindBy: 3, branch: 'main', latestSha: 'c2', latestMessage: 'Fix notch clicks', compareUrl: 'https://github.com/owner/trainer-hq/compare/x', sourceDir: '/src/trainer-hq' });
  });

  it('stays quiet when up to date, private, unpushed or offline', async () => {
    expect(await checkForUpdate(respond(200, { status: 'identical', ahead_by: 0 }))).toBeUndefined();
    expect(await checkForUpdate(respond(200, { status: 'behind', ahead_by: 0 }))).toBeUndefined();
    expect(await checkForUpdate(respond(404, {}))).toBeUndefined();
    expect(await checkForUpdate((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeUndefined();
  });
});
