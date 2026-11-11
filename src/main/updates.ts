import type { UpdateInfoType } from '@shared/types';

// Filled in at build time from the source checkout (see electron.vite.config.ts).
declare const __BUILD_SHA__: string;
declare const __BUILD_REPO__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_SOURCE_DIR__: string;

const API = 'https://api.github.com/repos';
const TIMEOUT_MS = 15_000;

export const buildInfo = (): { sha: string; repo: string; branch: string; sourceDir: string } => ({
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : '',
  repo: typeof __BUILD_REPO__ === 'string' ? __BUILD_REPO__ : '',
  branch: typeof __BUILD_BRANCH__ === 'string' ? __BUILD_BRANCH__ : '',
  sourceDir: typeof __BUILD_SOURCE_DIR__ === 'string' ? __BUILD_SOURCE_DIR__ : '',
});

// "owner/name" from an https or ssh GitHub remote URL.
export const githubRepo = (remoteUrl: string): string => {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : '';
};

// Asks GitHub how far the branch has moved past the commit this app was built from.
// Anonymous and read-only. A private repo, an unpushed local build or no network
// just means "no update shown", never an error for the user.
export const checkForUpdate = async (fetcher: typeof fetch = fetch): Promise<UpdateInfoType | undefined> => {
  const { sha, repo, branch, sourceDir } = buildInfo();
  if (!sha || !repo || !branch) return undefined;
  try {
    const response = await fetcher(`${API}/${repo}/compare/${sha}...${encodeURIComponent(branch)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'trainer-hq-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { status?: string; ahead_by?: number; html_url?: string; commits?: { sha: string; commit?: { message?: string } }[] };
    const behindBy = Number(data.ahead_by ?? 0);
    if (behindBy <= 0 || (data.status !== 'ahead' && data.status !== 'diverged')) return undefined;
    const latest = data.commits?.[data.commits.length - 1];
    return {
      behindBy,
      branch,
      latestSha: latest?.sha ?? '',
      latestMessage: (latest?.commit?.message ?? '').split('\n')[0],
      compareUrl: data.html_url ?? `https://github.com/${repo}/compare/${sha}...${branch}`,
      sourceDir,
    };
  } catch {
    return undefined;
  }
};
