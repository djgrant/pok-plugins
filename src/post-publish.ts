import { definePostCommand } from '@pokit/core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReleaseOptions } from './types';
import { PublishResult } from './publish';
import {
  groupSchema,
  normalizeGroups,
  publishedPackages,
  publishRegistry,
  readPackageName,
  readPackageVersion,
} from './internal';

/**
 * Machine-local hook run once a publish lands, if present.
 * It receives `{ registry, packages, repo }` as JSON, e.g.
 * to update the repos that depend on what shipped.
 */
export const PUBLISHED_HOOK = join(homedir(), '.config', 'pok', 'hooks', 'published');

/**
 * `post:publish`: runs {@link PUBLISHED_HOOK} with what `publish` shipped.
 * A separate command so a failing hook can be re-run on its own with
 * `pok post:publish`, which reads the versions back from the manifests
 * (they are what was just published). A project's own `post:publish`
 * replaces this one.
 */
export function postPublishCommand(opts: ReleaseOptions) {
  const { groups, names, multi } = normalizeGroups(opts.packages);

  return definePostCommand({
    label: 'Run the published hook',
    input: PublishResult,
    // Only resolved on direct invocation; after `publish`, its context applies.
    context: {
      verdaccio: {
        from: 'flag',
        schema: z.boolean().default(false),
        description: 'Report the Verdaccio registry instead of npmjs',
      },
      packages: {
        from: 'flag',
        schema: groupSchema(names, multi),
        description: `Package group that was published: ${names.join(', ')}`,
      },
    },
    run: async (r, ctx) => {
      if (!existsSync(PUBLISHED_HOOK)) {
        if (!ctx.input) r.reporter.info(`No hook at ${PUBLISHED_HOOK}`);
        return;
      }
      const result = ctx.input ?? {
        registry: publishRegistry(opts, ctx.context.verdaccio),
        packages: publishedPackages(groups[ctx.context.packages ?? 'default']!).map((p) => ({
          name: readPackageName(p.file),
          version: readPackageVersion(p.file),
        })),
      };
      // Dry run: nothing shipped.
      if (result.packages.length === 0) return;

      await r.group('Run the published hook', { layout: 'sequence' }, async (g) => {
        await g.activity(PUBLISHED_HOOK, async () => {
          try {
            await r.exec([PUBLISHED_HOOK, JSON.stringify({ ...result, repo: r.cwd })]);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
              `${PUBLISHED_HOOK} failed: ${reason}\nThe packages are published; re-run the hook with: pok post:publish`,
            );
          }
        });
      });
    },
  });
}
