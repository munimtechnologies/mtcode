import * as NodeServices from "@effect/platform-node/NodeServices";
import { DESKTOP_MCP_SERVER_NAME } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { claudeUserDefinesDesktopMcp } from "./desktopMcpUserConfig.ts";

describe("claudeUserDefinesDesktopMcp", () => {
  it.effect("is false when no config files exist", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });

      const defined = yield* claudeUserDefinesDesktopMcp({
        cwd: `${baseDir}/project`,
        environment: { CLAUDE_CONFIG_DIR: `${baseDir}/config` },
      });

      assert.equal(defined, false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is true when the project .mcp.json defines the server", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });
      yield* fileSystem.writeFileString(
        `${baseDir}/.mcp.json`,
        `{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/usr/local/bin/my-desktop"}}}`,
      );

      const defined = yield* claudeUserDefinesDesktopMcp({
        cwd: baseDir,
        environment: {},
      });

      assert.equal(defined, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is true when the user-scope .claude.json defines the server", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });
      yield* fileSystem.writeFileString(
        `${baseDir}/.claude.json`,
        `{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/usr/local/bin/my-desktop"}}}`,
      );

      const defined = yield* claudeUserDefinesDesktopMcp({
        environment: { CLAUDE_CONFIG_DIR: baseDir },
      });

      assert.equal(defined, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is true when .claude.json defines the server at local (projects) scope", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });
      const cwd = `${baseDir}/project`;
      yield* fileSystem.makeDirectory(cwd);
      yield* fileSystem.writeFileString(
        `${baseDir}/.claude.json`,
        `{"projects":{"${cwd}":{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/usr/local/bin/my-desktop"}}}}}`,
      );

      const defined = yield* claudeUserDefinesDesktopMcp({
        cwd,
        environment: { CLAUDE_CONFIG_DIR: baseDir },
      });

      assert.equal(defined, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("ignores other server names and malformed config", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });
      const cwd = `${baseDir}/project`;
      yield* fileSystem.makeDirectory(cwd);
      yield* fileSystem.writeFileString(
        `${cwd}/.mcp.json`,
        `{"mcpServers":{"another-server":{"command":"/usr/local/bin/other"}}}`,
      );
      yield* fileSystem.writeFileString(`${baseDir}/.claude.json`, "{not json");

      const defined = yield* claudeUserDefinesDesktopMcp({
        cwd,
        environment: { CLAUDE_CONFIG_DIR: baseDir },
      });

      assert.equal(defined, false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("prefers CLAUDE_CONFIG_DIR over HOME, matching the CLI's resolution", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-mcp-user-",
      });
      const configDir = `${baseDir}/config`;
      const homeDir = `${baseDir}/home`;
      yield* fileSystem.makeDirectory(configDir);
      yield* fileSystem.makeDirectory(homeDir);
      // Only HOME defines the server; an isolated CLAUDE_CONFIG_DIR session
      // would not see it, so injection must still happen.
      yield* fileSystem.writeFileString(
        `${homeDir}/.claude.json`,
        `{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/usr/local/bin/my-desktop"}}}`,
      );

      const defined = yield* claudeUserDefinesDesktopMcp({
        environment: { CLAUDE_CONFIG_DIR: configDir, HOME: homeDir },
      });

      assert.equal(defined, false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
