/**
 * One release unit. The npm name comes from the manifest's `name` field. A
 * published package must state its `build` (a command, or `false` for
 * "publishes source, no build step") — the build lives on the package it
 * produces, so a package can never publish while a workspace-level build
 * silently skips it. A manifest that is version-bumped but not published to
 * npm (e.g. a Claude plugin.json) must state `publish: false` instead.
 */
export type ReleasePackage =
  | {
      /** Manifest path (relative to project root) that bumpp bumps. */
      file: string;
      /**
       * Build command for this package, run from the project root before
       * publish. `false` states the package ships as-is (e.g. publishes
       * `src/`). Identical commands across packages run once.
       */
      build: string | false;
      publish?: true;
    }
  | {
      /** Manifest path (relative to project root) that bumpp bumps. */
      file: string;
      /** Version-bump only: the manifest is not published to npm. */
      publish: false;
      build?: undefined;
    };

/** A set of packages released together, with shared tag/commit templates. */
export interface PackageGroup {
  packages: ReleasePackage[];
  /** git tag template. Default `v%s`. */
  tag?: string;
  /** git commit message template. Default `release: v%s`. */
  commit?: string;
  /** Human label, used when the group is selectable via `--packages`. */
  label?: string;
}

export interface ReleaseOptions {
  /**
   * A package list (single group), a single group object, or a map of named
   * groups. A map with several groups exposes a `--packages <name>` flag on
   * both `version` and `publish` (pok's scoped/cli/all pattern).
   */
  packages: ReleasePackage[] | PackageGroup | Record<string, PackageGroup>;
  /** Publish registry. Default `https://registry.npmjs.org/`. */
  registry?: string;
  /** Expose a `--verdaccio` flag on `publish` for local-registry testing. */
  verdaccio?: boolean;
  /** Install step before publish. Default `pnpm install --frozen-lockfile`. */
  install?: string;
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
