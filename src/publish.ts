import { defineCommand } from '@pokit/core';
import type { Runner } from '@pokit/core';
import { z } from 'zod';
import { $ } from 'bun';
import type { ReleaseOptions } from './types';
import {
  buildCommands,
  DEFAULT_INSTALL,
  groupSchema,
  normalizeGroups,
  prereleaseDistTag,
  publishedPackages,
  publishRegistry,
  readPackageName,
  readPackageVersion,
} from './internal';

/**
 * What `publish` shipped, returned once the registry serves every version.
 * `packages` is empty for a dry run. `post:publish` takes it as `input`; it is
 * undefined when `pok post:publish` is invoked directly.
 */
export const PublishResult = z.object({
  registry: z.string(),
  packages: z.array(z.object({ name: z.string(), version: z.string() })),
});
export type PublishResult = z.infer<typeof PublishResult>;

/**
 * `publish` command: install → build → `pnpm publish`, wrapped in a sequenced
 * activity group, then waits until the registry serves every published version
 * and returns them as {@link PublishResult}. Run after `pok version`; also
 * supports `--dry-run` inspection and `--verdaccio` for local testing.
 */
export function publishCommand(opts: ReleaseOptions) {
  const { groups, names, multi } = normalizeGroups(opts.packages);
  const install = opts.install ?? DEFAULT_INSTALL;

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
      const registry = publishRegistry(opts, useVerdaccio);

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
      }));
      await waitForRegistry(r, packages, registry);
      return { registry, packages };
    },
  });
}

/** npm is eventually consistent: a version can 404 for a while after publish. */
async function waitForRegistry(r: Runner, pkgs: PublishResult['packages'], registry: string) {
  await r.group('Wait for published versions to land on the registry', { layout: 'sequence' }, async (g) => {
    await g.activity(pkgs.map((p) => `${p.name}@${p.version}`).join(', '), async () => {
      const deadline = Date.now() + 10 * 60_000;
      let pending = pkgs;
      while (pending.length > 0) {
        const landed = await Promise.all(pending.map((p) => isPublished(p, registry)));
        pending = pending.filter((_, i) => !landed[i]);
        if (pending.length === 0) break;
        if (Date.now() > deadline) {
          const specs = pending.map((p) => `${p.name}@${p.version}`).join(', ');
          throw new Error(`Timed out waiting for ${specs} on ${registry}`);
        }
        await Bun.sleep(5000);
      }
    });
  });
}

async function isPublished(pkg: PublishResult['packages'][number], registry: string) {
  // The packument (`/<name>`, what `npm view` reads) sits behind a CDN with a
  // 5-minute max-age, so a copy cached before the publish keeps reporting the
  // version as missing. The per-version document with a unique query string
  // bypasses that cache.
  const base = registry.replace(/\/+$/, '');
  const url = `${base}/${pkg.name.replace('/', '%2f')}/${pkg.version}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return true;
    if (res.status === 404) return false;
  } catch {}
  // Non-404 failures (e.g. 401 from a private registry) need npm's .npmrc auth.
  const res = await $`npm view ${pkg.name}@${pkg.version} version --prefer-online --registry ${registry}`
    .quiet()
    .nothrow();
  return res.exitCode === 0 && res.stdout.toString().trim() !== '';
}
