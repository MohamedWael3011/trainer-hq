import { execFile } from 'child_process';

const CHECK_TIMEOUT_MS = 15_000;
const SIGNED_IN_CACHE_MS = 5 * 60_000;

let signedInUntil = 0;

export const googleCloudSignedIn = (env: NodeJS.ProcessEnv): Promise<boolean> => {
  if (Date.now() < signedInUntil) return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('gcloud', ['auth', 'print-access-token', '--quiet'], { env, timeout: CHECK_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) {
        signedInUntil = Date.now() + SIGNED_IN_CACHE_MS;
        resolve(true);
        return;
      }
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      resolve(missing || !/auth|credential|login/i.test(`${stderr}`));
    });
  });
};
