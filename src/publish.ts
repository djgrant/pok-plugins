import { defineCommand } from '@pokit/core';
import type { CommandConfig } from '@pokit/core';
import { z } from 'zod';
import { homedir } from 'node:os';
import { $ } from 'bun';
import type { ReleaseOptions } from './types';
import {
  binSpecs,
  buildCommands,
  DEFAULT_INSTALL,
  DEFAULT_REGISTRY,
  normalizeGroups,
  prereleaseDistTag,
  publishedPackages,
  readPackageName,
} from './internal';

/**
 * Directory of the pnpm project that holds this machine's globally-installed
 * CLIs (its `node_modules/.bin` is on PATH). Machine config, not project
 * config: unset means published CLIs are not installed locally.
 */
const GLOBAL_DIR_ENV = 'POK_GLOBAL_DIR';

/**
 * `publish` command: install → build → `pnpm publish`, wrapped in a sequenced
 * activity group, then installs the just-published CLIs (packages with a `bin`)
 * into `$POK_GLOBAL_DIR` so the machine dogfoods what shipped. Run after
 * `pok version`; also supports `--dry-run` inspection and, when enabled,
 * `--verdaccio` for local testing.
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
      // Prereleases must not become `latest`: tag them with their identifier.
      const distTag = prereleaseDistTag(group);
      const distTagFlag = distTag ? ` --tag ${distTag}` : '';
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
            `pnpm ${filterArgs} publish --access public --registry ${registry}${distTagFlag}${dryRunFlag}${gitCheckFlag}`,
            { interactive: !c.dryRun },
          );
        });
      });

      if (c.dryRun) {
        r.reporter.info('Dry run complete. No packages were published.');
        return;
      }
      r.reporter.success(`Published to ${registry}`);

      const specs = binSpecs(group);
      const globalDir = process.env[GLOBAL_DIR_ENV]?.replace(/^~(?=\/|$)/, homedir());
      if (specs.length === 0 || useVerdaccio) return;
      if (!globalDir) {
        r.reporter.info(`Set ${GLOBAL_DIR_ENV} to install ${specs.join(', ')} locally after publish.`);
        return;
      }

      await r.group(`Install published CLIs into ${globalDir}`, { layout: 'sequence' }, async (g) => {
        await g.activity('Wait for published versions to land on the registry', async () => {
          // npm is eventually consistent: a version can 404 for a few seconds after publish.
          const maxAttempts = 30;
          const pending = new Set(specs);
          for (let attempt = 1; attempt <= maxAttempts && pending.size > 0; attempt++) {
            for (const spec of [...pending]) {
              const res = await $`npm view ${spec} version --prefer-online --registry ${registry}`
                .quiet()
                .nothrow();
              if (res.exitCode === 0 && res.stdout.toString().trim()) pending.delete(spec);
            }
            if (pending.size > 0) await Bun.sleep(2000);
          }
          if (pending.size > 0) {
            throw new Error(`Timed out waiting for ${[...pending].join(', ')} on ${registry}`);
          }
        });
        await g.activity(`Install ${specs.join(', ')}`, async () => {
          // Exact versions, so a lagging dist-tag can't install the previous
          // release. The just-published versions are by definition younger than
          // any minimumReleaseAge the global project enforces.
          await r.exec(
            ['pnpm', 'add', '--dir', globalDir, '--config.minimum-release-age=0', ...specs],
            { retry: { maxAttempts: 4, delay: 3000 } },
          );
        });
      });
    },
  }) as CommandConfig;
}
