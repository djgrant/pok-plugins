import type { PackageGroup, ReleaseOptions } from './types';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
export const DEFAULT_INSTALL = 'pnpm install --frozen-lockfile';
export const DEFAULT_BUILD = 'pnpm -r --if-present run build';
export const DEFAULT_PREID = 'rc';
export const DEFAULT_TAG = 'v%s';
export const DEFAULT_COMMIT = 'release: v%s';

function isSingleGroup(p: ReleaseOptions['packages']): p is PackageGroup {
  return Array.isArray((p as PackageGroup).files);
}

/**
 * Normalise `packages` into a name→group map. A single group is stored under
 * the reserved key `default`; `multi` tells callers whether to expose the
 * `--packages` selector flag.
 */
export function normalizeGroups(p: ReleaseOptions['packages']): {
  groups: Record<string, PackageGroup>;
  names: string[];
  multi: boolean;
} {
  if (isSingleGroup(p)) {
    return { groups: { default: p }, names: ['default'], multi: false };
  }
  const names = Object.keys(p);
  if (names.length === 0) {
    throw new Error('releaseRecipe: `packages` map must contain at least one group');
  }
  return { groups: p, names, multi: names.length > 1 };
}
