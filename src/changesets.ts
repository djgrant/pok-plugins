import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineCommand } from '@pokit/core';
import type { CommandConfig } from '@pokit/core';
import { z } from 'zod';
import type { ReleaseOptions } from './types';
import {
  DEFAULT_COMMIT,
  DEFAULT_TAG,
  normalizeGroups,
  readPackageVersion,
} from './internal';

/** `changeset` command: record a pending change for the next release. */
export function changesetCommand(): CommandConfig {
  return defineCommand({
    label: 'Describe a change for the next release',
    run: async (r) => {
      await r.exec('pnpm exec changeset', { interactive: true });
    },
  }) as CommandConfig;
}

/**
 * Changesets-backed `version` command: `changeset version` consumes the pending
 * changesets (bumping manifests and writing changelogs — lockstep comes from
 * `fixed` groups in .changeset/config.json, not from this config), then the
 * command refreshes the lockfile, commits, tags each release group whose
 * version moved, and pushes. Groups here only decide tag/commit templates and
 * what `publish` ships; the bump itself is workspace-wide.
 */
export function changesetsVersionCommand(opts: ReleaseOptions): CommandConfig {
  const { groups } = normalizeGroups(opts.packages);

  return defineCommand({
    label: 'Apply changesets and bump versions',
    context: {
      skipPush: {
        from: 'flag',
        schema: z.boolean().optional(),
        description: 'Skip pushing the commit and tags to remote',
      },
    } as never,
    run: async (r, ctx) => {
      const c = ctx.context as { skipPush?: boolean };
      const before = new Map(
        Object.entries(groups).map(([name, g]) => [
          name,
          readPackageVersion(g.packages[0]!.file),
        ]),
      );

      await r.exec('pnpm exec changeset version');
      // Not --frozen-lockfile: the point is to stamp the bumped workspace
      // versions into the lockfile.
      await r.exec('pnpm install');

      const released = Object.entries(groups).filter(
        ([name, g]) => readPackageVersion(g.packages[0]!.file) !== before.get(name),
      );
      if (released.length === 0) {
        throw new Error('changeset version bumped nothing — are there pending changesets?');
      }

      const tags = released.map(([, g]) =>
        (g.tag ?? DEFAULT_TAG).replaceAll('%s', readPackageVersion(g.packages[0]!.file)),
      );
      const message =
        released.length === 1
          ? (released[0]![1].commit ?? DEFAULT_COMMIT).replaceAll(
              '%s',
              readPackageVersion(released[0]![1].packages[0]!.file),
            )
          : `release: ${tags.join(', ')}`;

      // Only the files this flow owns — an otherwise-dirty worktree stays out
      // of the release commit.
      const paths = new Set<string>(['.changeset', 'pnpm-lock.yaml']);
      for (const group of Object.values(groups)) {
        for (const pkg of group.packages) {
          paths.add(pkg.file);
          paths.add(join(dirname(pkg.file), 'CHANGELOG.md'));
        }
      }
      const addArgs = [...paths].filter((p) => existsSync(p)).join(' ');

      await r.exec(`git add ${addArgs}`);
      await r.exec(`git commit -m "${message}"`);
      for (const tag of tags) {
        await r.exec(`git tag ${tag}`);
      }
      if (!c.skipPush) {
        await r.exec(`git push origin HEAD ${tags.join(' ')}`);
      }
      r.reporter.success(`Released ${tags.join(', ')}`);
    },
  }) as CommandConfig;
}
