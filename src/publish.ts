import { defineCommand } from '@pokit/core';
import type { CommandConfig } from '@pokit/core';
import { z } from 'zod';
import { $ } from 'bun';
import type { ReleaseOptions } from './types';
import {
  buildCommands,
  DEFAULT_INSTALL,
  DEFAULT_REGISTRY,
  normalizeGroups,
  publishedPackages,
  readPackageName,
} from './internal';

/**
 * `publish` command: install → build → `pnpm publish`, wrapped in a sequenced
 * activity group. The normal flow is `pok version` (push a tag a Release
 * workflow publishes from); this is the manual fallback plus `--dry-run`
 * inspection and, when enabled, `--verdaccio` for local testing.
 */
export function publishCommand(opts: ReleaseOptions): CommandConfig {
  const { groups, names, multi } = normalizeGroups(opts.packages);
  const install = opts.install ?? DEFAULT_INSTALL;
  const npmRegistry = opts.registry ?? DEFAULT_REGISTRY;

  const context: Record<string, unknown> = {
    dryRun: {
      from: 'flag',
      schema: z.boolean().default(false),
      description: 'Perform a dry run without actually publishing',
    },
  };
  if (opts.verdaccio) {
    context.verdaccio = {
      from: 'flag',
      schema: z.boolean().default(false),
      description: 'Publish to local Verdaccio (VERDACCIO_REGISTRY, default http://localhost:4873/) instead of npmjs',
    };
  }
  if (multi) {
    context.packages = {
      from: 'flag',
      schema: z.enum(names as [string, ...string[]]),
      description: `Package group to publish: ${names.join(', ')}`,
    };
  }

  return defineCommand({
    label: 'Publish packages',
    context: context as never,
    run: async (r, ctx) => {
      const c = ctx.context as { dryRun?: boolean; verdaccio?: boolean; packages?: string };
      const group = groups[multi ? c.packages! : 'default']!;
      const published = publishedPackages(group);
      if (published.length === 0) {
        throw new Error('publish: every package in the group is `publish: false`');
      }
      const builds = buildCommands(group);
      const useVerdaccio = Boolean(opts.verdaccio && c.verdaccio);
      const registry = useVerdaccio
        ? process.env.VERDACCIO_REGISTRY || 'http://localhost:4873/'
        : npmRegistry;

      const filterArgs = published
        .map((p) => `--filter "${readPackageName(p.file)}"`)
        .join(' ');
      const dryRunFlag = c.dryRun ? ' --dry-run' : '';
      const gitCheckFlag = c.dryRun || useVerdaccio ? ' --no-git-checks' : '';

      if (!c.dryRun) {
        const whoami = await $`npm whoami --registry ${registry}`.quiet().nothrow();
        if (whoami.exitCode !== 0) {
          throw new Error(`Not logged in to ${registry}. Run: npm login --registry ${registry}`);
        }
      }

      await r.group(`Publish to ${registry}`, { layout: 'sequence' }, async (g) => {
        await g.activity('Install workspace dependencies', async () => {
          await r.exec(install);
        });
        for (const command of builds) {
          await g.activity(`Build: ${command}`, async () => {
            await r.exec(command);
          });
        }
        await g.activity('Publish packages', async () => {
          // Interactive so npm can prompt for OTP / browser auth.
          await r.exec(
            `pnpm ${filterArgs} publish --access public --registry ${registry}${dryRunFlag}${gitCheckFlag}`,
            { interactive: !c.dryRun },
          );
        });
      });

      if (c.dryRun) {
        r.reporter.info('Dry run complete. No packages were published.');
      } else {
        r.reporter.success(`Published to ${registry}`);
      }
    },
  }) as CommandConfig;
}
