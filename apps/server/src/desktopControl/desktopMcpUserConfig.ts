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
