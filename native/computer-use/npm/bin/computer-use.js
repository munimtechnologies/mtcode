#!/usr/bin/env node
// Launcher for the Computer Use MCP server.
//
// The server itself is a native binary (Swift on macOS, Rust on Windows and
// Linux). npm is the distribution channel MCP clients already know how to run,
// so this script fetches the signed release binary that matches this package's
// version into a per-user cache on first run, then execs it with stdio passed
// straight through — the MCP conversation never touches Node.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const pkg = require("../package.json");
const REPO = "munimtechnologies/computer-use";
const VERSION = pkg.version;

function assetFor(platform, arch) {
  if (platform === "darwin")
    return { asset: "computer-use-macos-universal.zip", binary: "computer-use" };
  if (platform === "win32" && arch === "x64")
    return { asset: "computer-use-windows-x64.zip", binary: "computer-use.exe" };
  return null;
}

function cacheDir() {
  const base =
    process.env.COMPUTER_USE_CACHE_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || os.homedir(), "munim-computer-use")
      : path.join(
          process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
          "munim-computer-use",
        ));
  return path.join(base, VERSION);
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, bytes);
}

function extractZip(zipPath, dir) {
  // bsdtar on macOS and tar.exe on Windows 10+ both open zip archives, so no
  // dependency is needed for the two platforms that get prebuilt binaries.
  const result = spawnSync("tar", ["-xf", zipPath, "-C", dir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("could not extract the release archive with tar");
}

async function ensureBinary() {
  const target = assetFor(process.platform, process.arch);
  if (!target) {
    console.error(
      `munim-computer-use: no prebuilt binary for ${process.platform}/${process.arch}.\n` +
        `Build from source: https://github.com/${REPO}#build-from-source\n` +
        `then point COMPUTER_USE_BINARY at the result.`,
    );
    process.exit(1);
  }
  const override = process.env.COMPUTER_USE_BINARY;
  if (override) return override;

  const dir = cacheDir();
  const binary = path.join(dir, target.binary);
  if (fs.existsSync(binary)) return binary;

  fs.mkdirSync(dir, { recursive: true });
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${target.asset}`;
  const zipPath = path.join(dir, target.asset);
  console.error(`munim-computer-use: downloading ${target.asset} (v${VERSION})…`);
  await download(url, zipPath);
  extractZip(zipPath, dir);
  fs.rmSync(zipPath, { force: true });
  if (!fs.existsSync(binary)) throw new Error(`archive did not contain ${target.binary}`);
  if (process.platform !== "win32") fs.chmodSync(binary, 0o755);
  return binary;
}

async function main() {
  const binary = await ensureBinary();
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(`munim-computer-use: could not start ${binary}: ${error.message}`);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(`munim-computer-use: ${error.message}`);
  process.exit(1);
});
