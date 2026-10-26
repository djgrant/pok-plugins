import { definePostCommand } from '@pokit/core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReleaseOptions } from './types';
import { PublishResult } from './publish';
import {
  DEFAULT_REGISTRY,
  hasBin,
  normalizeGroups,
  publishedPackages,
  readPackageName,
  readPackageVersion,
} from './internal';

/** The pnpm project holding globally-installed CLIs; its node_modules/.bin is on PATH. */
const GLOBAL_DIR = join(homedir(), 'npmbin');

/**
 * Default `post:publish`: install the CLIs `publish` just shipped (packages
 * with a `bin`) into ~/npmbin at their exact versions, so this machine runs
 * what users get. Run directly as `pok post:publish`, it installs the current
 * manifest versions instead. A project replaces it by defining its own `post`
 * for `publish` (e.g. a `commands/publish.ts` exporting `post`).
 */
export function postPublishCommand(opts: ReleaseOptions) {
  const { groups } = normalizeGroups(opts.packages);
  const npmRegistry = opts.registry ?? DEFAULT_REGISTRY;

  return definePostCommand({
    label: 'Install published CLIs into ~/npmbin',
    input: PublishResult.optional(),
    run: async (r, ctx) => {
      // A Verdaccio publish isn't installable from the registry ~/npmbin uses.
      if (ctx.input && ctx.input.registry !== npmRegistry) return;

      const packages =
        ctx.input?.packages ??
        Object.values(groups).flatMap((g) =>
          publishedPackages(g).map((p) => ({
            name: readPackageName(p.file),
            version: readPackageVersion(p.file),
            bin: hasBin(p.file),
          })),
        );
      const specs = packages.filter((p) => p.bin).map((p) => `${p.name}@${p.version}`);
      if (specs.length === 0) return;

      await r.exec(['pnpm', 'add', '--dir', GLOBAL_DIR, ...specs], {
        retry: { maxAttempts: 4, delay: 3000 },
      });
    },
  });
}
