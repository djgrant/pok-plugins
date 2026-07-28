/**
 * A publishable unit: the package.json files bumpp rewrites, and (optionally)
 * the npm package names pnpm filters on when publishing.
 */
export interface PackageGroup {
  /** package.json paths (relative to project root) that bumpp bumps. */
  files: string[];
  /**
   * npm package names for `pnpm --filter` on publish. Omit to publish the whole
   * workspace with `pnpm -r publish`.
   */
  names?: string[];
  /** git tag template. Default `v%s`. */
  tag?: string;
  /** git commit message template. Default `release: v%s`. */
  commit?: string;
  /** Human label, used when the group is selectable via `--packages`. */
  label?: string;
}

export interface ReleaseOptions {
  /**
   * A single group, or a map of named groups. A map exposes a `--packages
   * <name>` flag on both `version` and `publish` (pok's scoped/cli/all pattern).
   */
  packages: PackageGroup | Record<string, PackageGroup>;
  /** Publish registry. Default `https://registry.npmjs.org/`. */
  registry?: string;
  /** Expose a `--verdaccio` flag on `publish` for local-registry testing. */
  verdaccio?: boolean;
  /** Install step before publish. Default `pnpm install --frozen-lockfile`. */
  install?: string;
  /** Build step before publish. Default `pnpm -r --if-present run build`. */
  build?: string;
  /** bumpp prerelease identifier. Default `rc`. */
  preid?: string;
}

export interface DocsOptions {
  /** Site name used in success messages, e.g. `notation-docs`. */
  name: string;
  /** Docs site directory, relative to the repository root. Default `./docs`. */
  dir?: string;
  /**
   * Dev server port. Default `3000`, shared by every repo — the dev server
   * leaves Vite's `strictPort` off, so a busy port falls through to the next
   * free one.
   */
  port?: number;
}
