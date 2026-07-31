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
  const name = readManifest(file).name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`publish: manifest ${file} has no \`name\` field`);
  }
  return name;
}

/** Version read from a manifest file (package.json). */
export function readPackageVersion(file: string): string {
  const version = readManifest(file).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`release: manifest ${file} has no \`version\` field`);
  }
  return version;
}

function readManifest(file: string): { name?: unknown; version?: unknown } {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
  } catch (error) {
    throw new Error(`publish: cannot read manifest ${file}: ${String(error)}`);
  }
}

/**
 * npm dist-tag for the group's prerelease versions, e.g. `rc` for `1.2.0-rc.3`.
 * `null` for stable versions (npm's default `latest` applies). Every published
 * manifest must agree — a mix of stable and prerelease, or of different
 * identifiers, has no single correct tag.
 */
export function prereleaseDistTag(group: PackageGroup): string | null {
  const tags = new Set<string | null>();
  for (const pkg of publishedPackages(group)) {
    const version = readManifest(pkg.file).version;
    if (typeof version !== 'string') {
      throw new Error(`publish: manifest ${pkg.file} has no \`version\` field`);
    }
    const prerelease = /^[^-+]+-([0-9A-Za-z-]+)/.exec(version);
    tags.add(prerelease ? prerelease[1]! : null);
  }
  if (tags.size > 1) {
    throw new Error(
      `publish: mixed versions across the group (${[...tags].map((t) => t ?? 'stable').join(', ')}); publish them separately`,
    );
  }
  return tags.values().next().value ?? null;
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
