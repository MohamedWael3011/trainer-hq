import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Stand-ins for the build-time values electron-vite injects.
  define: {
    __BUILD_SHA__: JSON.stringify('aaaa111'),
    __BUILD_REPO__: JSON.stringify('owner/trainer-hq'),
    __BUILD_BRANCH__: JSON.stringify('main'),
    __BUILD_SOURCE_DIR__: JSON.stringify('/src/trainer-hq'),
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Main-process code imports electron for paths; tests run in plain Node.
      electron: resolve(__dirname, 'test/fixtures/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
