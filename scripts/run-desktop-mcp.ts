#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - stdio relay launched by .mcp.json, no Effect runtime.
// Run the desktop-control MCP server (munim-computer-use) over stdio under MT
// Code's identity, for agents working in this checkout (see .mcp.json).
// Resolves like the app does: MTCODE_DESKTOP_MCP_PATH, a local
// munim-computer-use checkout (~/computer-use), then the release fetched by
// `vp run fetch:desktop-mcp`.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  desktopMcpPathOverride,
  munimComputerUseAssetKey,
  munimComputerUseCacheDir,
  munimComputerUseCheckoutBinaries,
  munimComputerUseExecutableName,
  mtcodeDesktopProfileEnv,
  parseMunimComputerUseManifest,
} from "@t3tools/shared/munimComputerUse";

const platform = process.platform;
if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
  console.error(`munim-computer-use has no build for ${platform}`);
  process.exit(1);
}
const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const checkout =
  process.env.MUNIM_COMPUTER_USE_CHECKOUT?.trim() ||
  NodePath.join(NodeOS.homedir(), "computer-use");
const manifest = parseMunimComputerUseManifest(
  NodeFS.readFileSync(NodePath.join(repoRoot, "native/munim-computer-use.json"), "utf8"),
);
const override = desktopMcpPathOverride(process.env);
const candidates = [
  ...(override ? [override] : []),
  ...munimComputerUseCheckoutBinaries(platform).map((parts) => NodePath.join(checkout, ...parts)),
  NodePath.join(
    munimComputerUseCacheDir({
      environment: process.env,
      homeDir: NodeOS.homedir(),
      version: manifest.version,
      key: munimComputerUseAssetKey(platform, process.arch === "arm64" ? "arm64" : "x64"),
      join: NodePath.join,
    }),
    munimComputerUseExecutableName(platform),
  ),
];
const binary = candidates.find((candidate) => NodeFS.existsSync(candidate));
if (!binary) {
  console.error(
    `munim-computer-use not found; build ~/computer-use, set MTCODE_DESKTOP_MCP_PATH, or run \`vp run fetch:desktop-mcp\`. Looked in:\n  ${candidates.join("\n  ")}`,
  );
  process.exit(1);
}
const child = NodeChildProcess.spawn(binary, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ...mtcodeDesktopProfileEnv() },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
