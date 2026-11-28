import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

/**
 * What a deployed build says about itself (#561): the full git SHA, when it was built, which
 * profile it is and whether the tree was clean. Written to `version.json` next to index.html and
 * mirrored in `<meta name="xasm-build">`, so "which commit is live?" is one curl, and
 * `deploy.py` can refuse a dirty tree and verify the live SHA after upload.
 */
export interface BuildVersion {
  /** Full 40-char commit SHA, or `unknown` when git is unavailable. */
  sha: string;
  /** ISO-8601 UTC. `SOURCE_DATE_EPOCH` (seconds) overrides the clock for reproducible builds. */
  builtAt: string;
  /** `test` = full shader catalog + picker, `public` = `VITE_PUBLIC_MODE=1` lock to v0.30b. */
  profile: 'test' | 'public';
  /** The Vite `base` the build was made for. */
  base: string;
  /** True when `git status --porcelain` was not empty at build time (or git was unavailable). */
  dirty: boolean;
}

export const VERSION_FILE = 'version.json';
export const BUILD_META_NAME = 'xasm-build';

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function readBuildVersion(opts: {
  cwd: string;
  base: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}): BuildVersion {
  const env = opts.env ?? process.env;
  const sha = git(['rev-parse', 'HEAD'], opts.cwd);
  const porcelain = git(['status', '--porcelain'], opts.cwd);
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  const builtAt =
    env.SOURCE_DATE_EPOCH && Number.isFinite(epoch)
      ? new Date(epoch * 1000)
      : (opts.now ?? new Date());
  return {
    sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown',
    builtAt: builtAt.toISOString(),
    profile: env.VITE_PUBLIC_MODE === '1' ? 'public' : 'test',
    base: opts.base,
    dirty: porcelain === null || porcelain.length > 0,
  };
}

/** The `<meta>` content: the SHA, with a `-dirty` suffix for a build from a modified tree. */
export function buildMetaContent(v: BuildVersion): string {
  return v.dirty ? `${v.sha}-dirty` : v.sha;
}

export function buildVersionPlugin(base: string): Plugin {
  let version: BuildVersion | null = null;
  const get = (): BuildVersion => (version ??= readBuildVersion({ cwd: process.cwd(), base }));

  return {
    name: 'xasm-build-version',
    apply: 'build',
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: BUILD_META_NAME, content: buildMetaContent(get()) }, injectTo: 'head' },
      ];
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: VERSION_FILE,
        source: `${JSON.stringify(get(), null, 2)}\n`,
      });
    },
  };
}
