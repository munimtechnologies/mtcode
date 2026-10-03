/**
 * User-config precedence for the bundled desktop MCP server (MT Code fork).
 *
 * Providers auto-inject the bundled `mt-desktop` server into every session
 * (see desktopMcpLaunch.ts). When the user's own Claude config already defines
 * a server with that name, the user's definition wins: injection is skipped so
 * the SDK-supplied entry cannot shadow theirs.
 *
 * Claude Code reads MCP servers from `<cwd>/.mcp.json` (project scope) and
 * from `.claude.json` under `CLAUDE_CONFIG_DIR` (or `HOME` when unset): the
 * top-level `mcpServers` map (user scope) and `projects[<cwd>].mcpServers`
 * (local scope). Read failures and malformed JSON count as "not defined" so a
 * broken config never hides the bundled tools.
 */
import * as NodeOS from "node:os";

import { DESKTOP_MCP_SERVER_NAME } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

type ClaudeUserMcpLookup = {
  readonly cwd?: string;
  readonly environment: NodeJS.ProcessEnv;
};

const definesDesktopServer = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false;
  const servers = (value as { readonly mcpServers?: unknown }).mcpServers;
  return (
    servers !== null &&
    typeof servers === "object" &&
    DESKTOP_MCP_SERVER_NAME in (servers as Record<string, unknown>)
  );
};

export const claudeUserDefinesDesktopMcp = Effect.fn("desktopControl.claudeUserDefinesDesktopMcp")(
  function* (input: ClaudeUserMcpLookup) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readConfig = (file: string) =>
      fileSystem.readFileString(file).pipe(
        Effect.map((contents): unknown => {
          try {
            return JSON.parse(contents) as unknown;
          } catch {
            return undefined;
          }
        }),
        Effect.orElseSucceed((): unknown => undefined),
      );

    if (input.cwd) {
      const projectConfig = yield* readConfig(path.join(input.cwd, ".mcp.json"));
      if (definesDesktopServer(projectConfig)) return true;
    }

    // Mirror the CLI's resolution: `.claude.json` lives in CLAUDE_CONFIG_DIR
    // when set (instance isolation via makeClaudeEnvironment), else HOME.
    const configDirectory =
      input.environment.CLAUDE_CONFIG_DIR?.trim() || input.environment.HOME?.trim() || "";
    if (configDirectory.length === 0) return false;

    const userConfig = yield* readConfig(path.join(configDirectory, ".claude.json"));
    if (definesDesktopServer(userConfig)) return true;
    if (input.cwd && userConfig !== null && typeof userConfig === "object") {
      const projects = (userConfig as { readonly projects?: unknown }).projects;
      if (projects !== null && typeof projects === "object") {
        return definesDesktopServer((projects as Record<string, unknown>)[input.cwd]);
      }
    }
    return false;
  },
);

/**
 * Capture filesystem dependencies at adapter construction so sessions can run
 * the lookup with `R = never`, mirroring `makeResolveEnabledDesktopMcp`.
 */
export const makeClaudeUserDefinesDesktopMcp = Effect.fn(
  "desktopControl.makeClaudeUserDefinesDesktopMcp",
)(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return (input: ClaudeUserMcpLookup) =>
    claudeUserDefinesDesktopMcp(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
});

type UserMcpLookup = {
  readonly cwd?: string;
  readonly environment: NodeJS.ProcessEnv;
};

const userHomeDirectory = (environment: NodeJS.ProcessEnv): string =>
  environment.HOME?.trim() || environment.USERPROFILE?.trim() || NodeOS.homedir();

/**
 * Cursor reads MCP servers from `<cwd>/.cursor/mcp.json` (project) and
 * `~/.cursor/mcp.json` (global), with Claude's `mcpServers` shape. The Agent
 * SDK loads both through `settingSources`, so a user-defined `mt-desktop`
 * there wins over injection.
 */
export const cursorUserDefinesDesktopMcp = Effect.fn("desktopControl.cursorUserDefinesDesktopMcp")(
  function* (input: UserMcpLookup) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = [
      ...(input.cwd ? [path.join(input.cwd, ".cursor", "mcp.json")] : []),
      path.join(userHomeDirectory(input.environment), ".cursor", "mcp.json"),
    ];
    for (const file of files) {
      const config = yield* fileSystem.readFileString(file).pipe(
        Effect.map((contents): unknown => {
          try {
            return JSON.parse(contents) as unknown;
          } catch {
            return undefined;
          }
        }),
        Effect.orElseSucceed((): unknown => undefined),
      );
      if (definesDesktopServer(config)) return true;
    }
    return false;
  },
);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOML_DESKTOP_KEY = `(?:${escapeRegExp(DESKTOP_MCP_SERVER_NAME)}|"${escapeRegExp(DESKTOP_MCP_SERVER_NAME)}"|'${escapeRegExp(DESKTOP_MCP_SERVER_NAME)}')`;
const TOML_TABLE_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;

/**
 * True when Grok `config.toml` text defines `[mcp_servers.mt-desktop]`, either
 * as a table (or sub-table), a dotted key, or a key inside `[mcp_servers]`.
 */
export function grokTomlDefinesDesktopMcp(contents: string): boolean {
  const serverTable = new RegExp(`^mcp_servers\\s*\\.\\s*${TOML_DESKTOP_KEY}(?:\\s*\\.|$)`);
  const dottedKey = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${TOML_DESKTOP_KEY}\\s*[.=]`);
  const keyInServers = new RegExp(`^\\s*${TOML_DESKTOP_KEY}\\s*[.=]`);
  let table = "";
  for (const line of contents.split(/\r?\n/)) {
    const header = TOML_TABLE_HEADER.exec(line);
    if (header !== null) {
      table = header[1] ?? "";
      if (serverTable.test(table)) return true;
      continue;
    }
    if (table === "" && dottedKey.test(line)) return true;
    if (table === "mcp_servers" && keyInServers.test(line)) return true;
  }
  return false;
}

/**
 * Grok reads MCP servers from `~/.grok/config.toml` (`GROK_HOME` when set) and
 * repo-level `.grok/config.toml` files on the cwd → git-root chain. A
 * user-defined `mt-desktop` in any of them wins over injection.
 */
export const grokUserDefinesDesktopMcp = Effect.fn("desktopControl.grokUserDefinesDesktopMcp")(
  function* (input: UserMcpLookup) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const readToml = (file: string) =>
      fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    const grokHome =
      input.environment.GROK_HOME?.trim() ||
      path.join(userHomeDirectory(input.environment), ".grok");
    if (grokTomlDefinesDesktopMcp(yield* readToml(path.join(grokHome, "config.toml")))) {
      return true;
    }
    if (!input.cwd) return false;
    let directory = path.resolve(input.cwd);
    for (;;) {
      if (
        grokTomlDefinesDesktopMcp(yield* readToml(path.join(directory, ".grok", "config.toml")))
      ) {
        return true;
      }
      const isGitRoot = yield* fileSystem
        .exists(path.join(directory, ".git"))
        .pipe(Effect.orElseSucceed(() => false));
      const parent = path.dirname(directory);
      if (isGitRoot || parent === directory) return false;
      directory = parent;
    }
  },
);

/** Captures filesystem services so the Cursor lookup runs with `R = never`. */
export const makeCursorUserDefinesDesktopMcp = Effect.fn(
  "desktopControl.makeCursorUserDefinesDesktopMcp",
)(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return (input: UserMcpLookup) =>
    cursorUserDefinesDesktopMcp(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
});

/** Captures filesystem services so the Grok lookup runs with `R = never`. */
export const makeGrokUserDefinesDesktopMcp = Effect.fn(
  "desktopControl.makeGrokUserDefinesDesktopMcp",
)(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return (input: UserMcpLookup) =>
    grokUserDefinesDesktopMcp(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
});
