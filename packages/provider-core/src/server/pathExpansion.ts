// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

/**
 * Spawned processes don't get shell expansion, so env vars like
 * `CODEX_HOME=~/.codex-work` would be passed verbatim and treated as relative
 * paths by the receiver.
 */
export function expandHomePath(value: string, home: string): string {
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.join(home, value.slice(2));
  }
  return value;
}

/**
 * Inverse of `expandHomePath` for display: a path at or below `home` is shown as `~` or `~/…`. Anything else is returned
 * unchanged, so callers can print server paths without leaking a long home
 * prefix into every label.
 */
export function collapseHomePath(value: string, home: string): string {
  if (value === home) return "~";
  for (const separator of ["/", "\\"]) {
    if (value.startsWith(home + separator)) {
      return `~${separator}${value.slice(home.length + 1)}`;
    }
  }
  return value;
}
