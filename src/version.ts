import { defineCommand } from '@pokit/core';
import type { CommandConfig } from '@pokit/core';
import { z } from 'zod';
import { versionBump } from 'bumpp';
import type { ReleaseOptions } from './types';
import { DEFAULT_COMMIT, DEFAULT_PREID, DEFAULT_TAG, groupSchema, normalizeGroups } from './internal';

/**
 * `version` command: bumps the configured package.json files with bumpp,
 * commits, tags, and pushes. Follow with `pok publish`.
 *
 * `pok version [release-type]` — e.g. `pok version patch`. No release-type means
 * bumpp prompts interactively.
 */
export function versionCommand(opts: ReleaseOptions): CommandConfig {
  const { groups, names, multi } = normalizeGroups(opts.packages);
  const preid = opts.preid ?? DEFAULT_PREID;

  return defineCommand({
    label: 'Bump package versions',
    context: {
      skipPush: {
        from: 'flag',
        schema: z.boolean().optional(),
        description: 'Skip pushing the commit and tag to remote',
      },
      packages: {
        from: 'flag',
        // Required (so pok prompts) only when there is a group to choose.
        schema: groupSchema(names, multi),
        description: `Package group to version: ${names.join(', ')}`,
      },
    },
    run: async (_r, ctx) => {
      const c = ctx.context;
      const group = groups[c.packages ?? 'default']!;
      const release = ctx.extraArgs[0] || 'prompt';
      const skipConfirm = release !== 'prompt';

      await versionBump({
        release,
        files: group.packages.map((p) => p.file),
        push: !c.skipPush,
        tag: group.tag ?? DEFAULT_TAG,
        commit: group.commit ?? DEFAULT_COMMIT,
        preid,
        confirm: !skipConfirm,
      });
    },
  }) as CommandConfig;
}
