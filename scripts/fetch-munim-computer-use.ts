#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a tiny standalone CLI.
// Fetch the pinned munim-computer-use release (binary for this machine + the
// Chrome extension) into the shared cache, where a dev checkout's server and
// desktop app find it. Packaged builds do the same inside build-desktop-artifact.
//
//   node scripts/fetch-munim-computer-use.ts
import * as NodePath from "node:path";

import { munimComputerUseAssetKey } from "@t3tools/shared/munimComputerUse";

import { fetchPinnedAsset, readManifest } from "./lib/munim-computer-use.ts";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone build script has no Effect runtime.
const platform = process.platform;
if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
  console.error(`munim-computer-use has no build for ${platform}`);
  process.exit(1);
}
const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const manifest = await readManifest(repoRoot);
for (const key of [
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone build script has no Effect runtime.
  munimComputerUseAssetKey(platform, process.arch === "arm64" ? "arm64" : "x64"),
  "chrome-extension",
] as const) {
  const dir = await fetchPinnedAsset({
    manifest,
    key,
    environment: process.env,
    log: (message) => console.log(message),
  });
  console.log(`${key}: ${dir}`);
}
