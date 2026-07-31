import { readFileSync } from 'node:fs';
import type { PackageGroup, ReleaseOptions } from './types';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
export const DEFAULT_INSTALL = 'pnpm install --frozen-lockfile';
export const DEFAULT_PREID = 'rc';
export const DEFAULT_TAG = 'v%s';
export const DEFAULT_COMMIT = 'release: v%s';

function isSingleGroup(p: ReleaseOptions['packages']): p is PackageGroup {
  return Array.isArray((p as PackageGroup).packages);
}

/**
 * Normalise `packages` into a name→group map. A bare package list or a single
 * group is stored under the reserved key `default`; `multi` tells callers
 * whether to expose the `--packages` selector flag.
 */
export function normalizeGroups(p: ReleaseOptions['packages']): {
  groups: Record<string, PackageGroup>;
  names: string[];
  multi: boolean;
} {
  if (Array.isArray(p)) {
    return { groups: { default: { packages: p } }, names: ['default'], multi: false };
  }
  if (isSingleGroup(p)) {
    return { groups: { default: p }, names: ['default'], multi: false };
  }
  const names = Object.keys(p);
  if (names.length === 0) {
    throw new Error('release: `packages` map must contain at least one group');
  }
  return { groups: p, names, multi: names.length > 1 };
}

/** Packages in the group that publish to npm (not marked `publish: false`). */
export function publishedPackages(group: PackageGroup) {
  return group.packages.filter(
    (p): p is Extract<typeof p, { build: string | false }> => p.publish !== false,
  );
}

/** npm package name read from a manifest file (package.json). */
export function readPackageName(file: string): string {
  let manifest: { name?: unknown };
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown };
  } catch (error) {
    throw new Error(`publish: cannot read manifest ${file}: ${String(error)}`);
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error(`publish: manifest ${file} has no \`name\` field`);
  }
  return manifest.name;
}

/** Build commands for the group's published packages, deduplicated in order. */
export function buildCommands(group: PackageGroup): string[] {
  const commands: string[] = [];
  for (const pkg of publishedPackages(group)) {
    if (pkg.build !== false && !commands.includes(pkg.build)) {
      commands.push(pkg.build);
    }
  }
  return commands;
}
