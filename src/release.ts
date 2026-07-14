import { fromStatic } from '@pokit/core';
import type { Mountable } from '@pokit/core';
import type { ReleaseOptions } from './types';
import { versionCommand } from './version';
import { publishCommand } from './publish';

/**
 * Mount the shared `version` + `publish` release flow at the CLI root.
 *
 * @example
 * // pok.config.ts
 * export default defineConfig({
 *   plugins: [release({
 *     packages: { files: ['packages/a/package.json'], names: ['a'] },
 *   })],
 * });
 */
export function release(opts: ReleaseOptions): Mountable {
  return fromStatic({
    version: versionCommand(opts),
    publish: publishCommand(opts),
  });
}
