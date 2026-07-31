import { defineConfig } from '@pokit/core';
import { release } from './src/release';

// Dogfood: pok-plugins publishes itself with its own release plugin. Standalone
// single package, so the group names it explicitly (pnpm --filter matches the
// root project) and there is no workspace build step to run.
export default defineConfig({
  appName: 'pok-plugins',
  plugins: [
    release({
      packages: [{ file: 'package.json', build: 'pnpm exec tsc --noEmit' }],
    }),
  ],
});
