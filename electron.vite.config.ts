import { execSync } from 'child_process';
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = { '@shared': resolve('src/shared') };

const git = (command: string): string => {
  try {
    return execSync(`git ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// Which commit this build came from, and where updates are published, for the in-app update check.
const remote = git('remote get-url origin').match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
const buildInfo = {
  __BUILD_SHA__: JSON.stringify(git('rev-parse HEAD')),
  __BUILD_REPO__: JSON.stringify(remote ? `${remote[1]}/${remote[2]}` : ''),
  __BUILD_BRANCH__: JSON.stringify(git('rev-parse --abbrev-ref origin/HEAD').replace(/^origin\//, '') || 'main'),
  __BUILD_SOURCE_DIR__: JSON.stringify(resolve('.')),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    define: buildInfo,
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
  },
});
