import { fromStatic } from '@pokit/core';
import type { Mountable } from '@pokit/core';
import type { ReleaseOptions } from './types';
import { versionCommand } from './version';
import { publishCommand } from './publish';
import { changesetCommand, changesetsVersionCommand } from './changesets';

/**
 * Mount the shared `version` + `publish` release flow at the CLI root.
 *
 * @example
 * // pok.config.ts
 * export default defineConfig({
 *   plugins: [release({
 *     packages: [
 *       { file: 'packages/a/package.json', build: 'pnpm --filter a run build' },
 *     ],
 *   })],
 * });
 */
export function release(opts: ReleaseOptions): Mountable {
  if (opts.changesets) {
    return fromStatic({
      changeset: changesetCommand(),
      version: changesetsVersionCommand(opts),
      publish: publishCommand(opts),
    });
  }
  return fromStatic({
    version: versionCommand(opts),
    publish: publishCommand(opts),
  });
}
