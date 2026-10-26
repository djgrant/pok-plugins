import { defineCommand } from '@pokit/core';
import type { CommandConfig, Runner } from '@pokit/core';
import { z } from 'zod';
import { $ } from 'bun';
import type { ReleaseOptions } from './types';
import {
  buildCommands,
  DEFAULT_INSTALL,
  DEFAULT_REGISTRY,
  groupSchema,
  normalizeGroups,
  prereleaseDistTag,
  publishedPackages,
  readPackageName,
  readPackageVersion,
  hasBin,
} from './internal';

/**
 * What `publish` shipped, returned once the registry serves every version.
 * `packages` is empty for a dry run. A project's `post:publish` command takes
 * it as `input` (undefined when `pok post:publish` is invoked directly).
 */
export const PublishResult = z.object({
  registry: z.string(),
  packages: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      /** Whether the manifest declares a `bin` (the package ships a CLI). */
      bin: z.boolean(),
    }),
  ),
});
export type PublishResult = z.infer<typeof PublishResult>;

/**
 * `publish` command: install → build → `pnpm publish`, wrapped in a sequenced
 * activity group, then waits until the registry serves every published version
 * and returns them as {@link PublishResult}. Run after `pok version`; also
 * supports `--dry-run` inspection and `--verdaccio` for local testing.
 */
export function publishCommand(opts: ReleaseOptions): CommandConfig {
  const { groups, names, multi } = normalizeGroups(opts.packages);
  const install = opts.install ?? DEFAULT_INSTALL;
  const npmRegistry = opts.registry ?? DEFAULT_REGISTRY;

  return defineCommand({
    label: 'Publish packages',
    output: PublishResult,
    format(data, reporter) {
      if (data.packages.length > 0) reporter.success(`Published to ${data.registry}`);
    },
    context: {
      dryRun: {
        from: 'flag',
        schema: z.boolean().default(false),
        description: 'Perform a dry run without actually publishing',
      },
      verdaccio: {
        from: 'flag',
        schema: z.boolean().default(false),
        description: 'Publish to local Verdaccio (VERDACCIO_REGISTRY, default http://localhost:4873/) instead of npmjs',
      },
      packages: {
        from: 'flag',
        // Required (so pok prompts) only when there is a group to choose.
        schema: groupSchema(names, multi),
        description: `Package group to publish: ${names.join(', ')}`,
      },
    },
    run: async (r, ctx) => {
      const c = ctx.context;
      const group = groups[c.packages ?? 'default']!;
      const published = publishedPackages(group);
      if (published.length === 0) {
        throw new Error('publish: every package in the group is `publish: false`');
      }
      const builds = buildCommands(group);
      const useVerdaccio = c.verdaccio;
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
        return { registry, packages: [] };
      }

      const packages = published.map((p) => ({
        name: readPackageName(p.file),
        version: readPackageVersion(p.file),
        bin: hasBin(p.file),
      }));
      await waitForRegistry(r, packages, registry);
      return { registry, packages };
    },
  }) as CommandConfig;
}

/** npm is eventually consistent: a version can 404 for a while after publish. */
async function waitForRegistry(r: Runner, pkgs: PublishResult['packages'], registry: string) {
  await r.group('Wait for published versions to land on the registry', { layout: 'sequence' }, async (g) => {
    await g.activity(pkgs.map((p) => `${p.name}@${p.version}`).join(', '), async () => {
      const maxAttempts = 30;
      const pending = new Set(pkgs.map((p) => `${p.name}@${p.version}`));
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
  });
}
