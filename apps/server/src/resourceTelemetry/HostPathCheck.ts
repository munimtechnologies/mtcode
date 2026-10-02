// @effect-diagnostics nodeBuiltinImport:off - resolves both Windows and POSIX spellings, not just the host's.
import * as NodePath from "node:path";
import type { HostPathCheckInput, HostPathCheckResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

/**
 * Where a path from a prompt would live on this host, or null when it cannot
 * name anything here (a drive-letter path on macOS/Linux). `~`, `$HOME` and
 * `%USERPROFILE%` prefixes and relative paths resolve against the home
 * directory, so "~/dev/app" is checked on every machine it could be on.
 */
export function resolveHostPath(
  raw: string,
  host: { readonly homeDirectory: string; readonly platform: NodeJS.Platform },
): string | null {
  const path = host.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const homePrefix = /^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|%HOMEPATH%)(?=$|[\\/])/i.exec(trimmed);
  if (homePrefix) {
    const rest = trimmed.slice(homePrefix[0].length).replace(/^[\\/]+/, "");
    return rest.length === 0 ? host.homeDirectory : path.join(host.homeDirectory, rest);
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return host.platform === "win32" ? path.normalize(trimmed) : null;
  }
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.join(host.homeDirectory, trimmed);
}

/** Checks each path with a short deadline: a dead network mount must not stall routing. */
export const checkHostPaths = Effect.fn("HostPathCheck.checkHostPaths")(function* (
  input: HostPathCheckInput,
  host: { readonly homeDirectory: string; readonly platform: NodeJS.Platform },
) {
  const fs = yield* FileSystem.FileSystem;
  const results = yield* Effect.forEach(
    input.paths,
    (raw) => {
      const resolved = resolveHostPath(raw, host);
      if (resolved === null) return Effect.succeed(null);
      return fs.exists(resolved).pipe(
        Effect.timeout("1 second"),
        Effect.orElseSucceed(() => false),
        Effect.map((exists) => (exists ? raw : null)),
      );
    },
    { concurrency: 4 },
  );
  return {
    existing: results.filter((path): path is string => path !== null),
  } satisfies HostPathCheckResult;
});
