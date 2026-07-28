import { defineCommand, fromStatic } from '@pokit/core';
import type { CommandConfig, Mountable } from '@pokit/core';
import type { DocsOptions } from './types';

const DEFAULT_DIR = './docs';
// One shared default across repos. The @notation/docs dev server never sets
// Vite's `strictPort`, so when the port is busy Vite just picks the next free
// one — no need for per-repo port allocation.
const DEFAULT_PORT = 3000;

/**
 * Mount `docs dev|build|deploy` at the CLI root for a documentation site built
 * with `@notation/docs`. The plugin owns the framework contract: the site
 * lives in `./docs` (unless `dir` overrides it) and is driven by its `docs`
 * binary via `pnpm exec docs <cmd>`.
 *
 * @example
 * // pok.config.ts
 * export default defineConfig({
 *   plugins: [docs({ name: 'notation-docs' })],
 * });
 */
export function docs(opts: DocsOptions): Mountable {
  const dir = opts.dir ?? DEFAULT_DIR;
  const port = opts.port ?? DEFAULT_PORT;

  return fromStatic({
    docs: defineCommand({
      label: 'Documentation site',
    }) as CommandConfig,

    'docs.dev': defineCommand({
      label: 'Start dev server',
      run: async (r) => {
        r.reporter.info(`Starting documentation site at http://localhost:${port}`);
        await r.exec(`pnpm exec docs dev --port ${port}`, { cwd: dir });
      },
    }) as CommandConfig,

    'docs.build': defineCommand({
      label: 'Build for production',
      run: async (r) => {
        await r.exec('pnpm exec docs build', { cwd: dir });
        r.reporter.success(`Built ${opts.name}`);
      },
    }) as CommandConfig,

    // Deployment config is inline in the site's vite.config.ts, so wrangler
    // picks up the emitted .wrangler/deploy/config.json — there is no
    // wrangler.toml.
    'docs.deploy': defineCommand({
      label: 'Build and deploy to Cloudflare',
      run: async (r) => {
        await r.exec('pnpm exec docs deploy', { cwd: dir });
        r.reporter.success(`Deployed ${opts.name}`);
      },
    }) as CommandConfig,
  });
}
