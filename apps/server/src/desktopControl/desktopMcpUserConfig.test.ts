import * as NodeServices from "@effect/platform-node/NodeServices";
import { DESKTOP_MCP_SERVER_NAME } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  claudeUserDefinesDesktopMcp,
  cursorUserDefinesDesktopMcp,
  grokTomlDefinesDesktopMcp,
  grokUserDefinesDesktopMcp,
} from "./desktopMcpUserConfig.ts";

describe("claudeUserDefinesDesktopMcp", () => {
  it.effect("is false when no config files exist", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-user-",
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
        prefix: "munim-computer-use-user-",
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
        prefix: "munim-computer-use-user-",
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
        prefix: "munim-computer-use-user-",
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
        prefix: "munim-computer-use-user-",
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
        prefix: "munim-computer-use-user-",
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

describe("cursorUserDefinesDesktopMcp", () => {
  it.effect("reads the project and global Cursor mcp.json files", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-cursor-",
      });
      const project = `${baseDir}/project`;
      const home = `${baseDir}/home`;
      yield* fileSystem.makeDirectory(`${project}/.cursor`, { recursive: true });
      yield* fileSystem.makeDirectory(`${home}/.cursor`, { recursive: true });
      const lookup = cursorUserDefinesDesktopMcp({ cwd: project, environment: { HOME: home } });

      assert.equal(yield* lookup, false);
      yield* fileSystem.writeFileString(
        `${home}/.cursor/mcp.json`,
        `{"mcpServers":{"other":{"command":"/bin/other"}}}`,
      );
      assert.equal(yield* lookup, false);
      yield* fileSystem.writeFileString(
        `${project}/.cursor/mcp.json`,
        `{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/bin/mine"}}}`,
      );
      assert.equal(yield* lookup, true);
      yield* fileSystem.remove(`${project}/.cursor/mcp.json`);
      yield* fileSystem.writeFileString(
        `${home}/.cursor/mcp.json`,
        `{"mcpServers":{"${DESKTOP_MCP_SERVER_NAME}":{"command":"/bin/mine"}}}`,
      );
      assert.equal(yield* lookup, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("grokTomlDefinesDesktopMcp", () => {
  it("matches tables, sub-tables, dotted keys, and keys under [mcp_servers]", () => {
    const name = DESKTOP_MCP_SERVER_NAME;
    assert.isTrue(grokTomlDefinesDesktopMcp(`[mcp_servers.${name}]\ncommand = "/bin/x"`));
    assert.isTrue(grokTomlDefinesDesktopMcp(`[mcp_servers."${name}".env]\nA = "1"`));
    assert.isTrue(grokTomlDefinesDesktopMcp(`mcp_servers.${name}.command = "/bin/x"`));
    assert.isTrue(grokTomlDefinesDesktopMcp(`[mcp_servers]\n${name} = { command = "/bin/x" }`));
    assert.isFalse(grokTomlDefinesDesktopMcp(`[mcp_servers.${name}-old]\ncommand = "/bin/x"`));
    assert.isFalse(grokTomlDefinesDesktopMcp(`[mcp]\n${name} = 1`));
    assert.isFalse(grokTomlDefinesDesktopMcp(`# [mcp_servers.${name}]`));
  });
});

describe("grokUserDefinesDesktopMcp", () => {
  it.effect("reads GROK_HOME config.toml and repo .grok/config.toml up to the git root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-grok-",
      });
      const repo = `${baseDir}/repo`;
      const cwd = `${repo}/packages/app`;
      const grokHome = `${baseDir}/grok-home`;
      yield* fileSystem.makeDirectory(`${repo}/.git`, { recursive: true });
      yield* fileSystem.makeDirectory(`${repo}/.grok`, { recursive: true });
      yield* fileSystem.makeDirectory(cwd, { recursive: true });
      yield* fileSystem.makeDirectory(grokHome, { recursive: true });
      yield* fileSystem.makeDirectory(`${baseDir}/.grok`, { recursive: true });
      const lookup = grokUserDefinesDesktopMcp({ cwd, environment: { GROK_HOME: grokHome } });
      const desktopTable = `[mcp_servers.${DESKTOP_MCP_SERVER_NAME}]\ncommand = "/bin/mine"\n`;

      // Above the git root is outside Grok's repo config chain.
      yield* fileSystem.writeFileString(`${baseDir}/.grok/config.toml`, desktopTable);
      assert.equal(yield* lookup, false);
      yield* fileSystem.writeFileString(`${repo}/.grok/config.toml`, desktopTable);
      assert.equal(yield* lookup, true);
      yield* fileSystem.remove(`${repo}/.grok/config.toml`);
      yield* fileSystem.writeFileString(`${grokHome}/config.toml`, desktopTable);
      assert.equal(yield* lookup, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
