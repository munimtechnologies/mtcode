// @effect-diagnostics nodeBuiltinImport:off - fixture archives on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  MTCODE_AGENT_CURSOR_BUNDLE_ID,
  munimComputerUsePinProblems,
  parseMunimComputerUseManifest,
  type MunimComputerUseManifest,
} from "@t3tools/shared/munimComputerUse";

import { fetchPinnedAsset, readManifest, stageMunimComputerUse } from "./munim-computer-use.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "../..");

function scratch(): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "munim-computer-use-test-"));
}

/** A release-shaped tar.gz holding `files`, plus its sha256. */
function archiveOf(dir: string, name: string, files: Record<string, string>) {
  const content = NodePath.join(dir, `${name}-content`);
  NodeFS.mkdirSync(content, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    NodeFS.writeFileSync(NodePath.join(content, file), text);
  }
  const archive = NodePath.join(dir, name);
  NodeChildProcess.execFileSync("tar", ["-czf", archive, "-C", content, "."]);
  const sha256 = NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(archive)).digest("hex");
  return { archive, sha256 };
}

function manifestWith(assets: MunimComputerUseManifest["assets"]): MunimComputerUseManifest {
  return { repository: "munimtechnologies/munim-computer-use", version: "9.9.9", assets };
}

describe("munim-computer-use pin", () => {
  it("the checked-in pin parses and names every platform MT Code ships", async () => {
    const manifest = await readManifest(repoRoot);
    for (const key of [
      "darwin-universal",
      "win32-x64",
      "linux-x64",
      "linux-arm64",
      "chrome-extension",
    ]) {
      assert.ok(manifest.assets[key], `asset ${key} is pinned`);
    }
  });

  it("an unfilled placeholder is reported, not fetched", () => {
    const manifest = parseMunimComputerUseManifest(
      JSON.stringify({
        repository: "r/r",
        version: "FILL-AT-RELEASE",
        assets: { "linux-x64": { name: "a.tar.gz", sha256: "FILL-AT-RELEASE" } },
      }),
    );
    const problems = munimComputerUsePinProblems(manifest, ["linux-x64", "chrome-extension"]);
    assert.equal(problems.length, 3);
    assert.match(problems.join("\n"), /placeholder/);
    assert.match(problems.join("\n"), /no asset pinned for chrome-extension/);
  });

  it("refuses to fetch against the placeholder", async () => {
    let downloaded = false;
    const error = await fetchPinnedAsset({
      manifest: manifestWith({ "linux-x64": { name: "a.tar.gz", sha256: "FILL-AT-RELEASE" } }),
      key: "linux-x64",
      environment: { MTCODE_COMPUTER_USE_CACHE: scratch() },
      download: async () => {
        downloaded = true;
      },
    }).catch((cause: unknown) => cause);
    assert.ok(error instanceof Error);
    assert.match((error as Error).message, /not filled in/);
    assert.equal(downloaded, false);
  });

  it("verifies the sha256, unpacks into the cache, and reuses a verified unpack", async () => {
    const dir = scratch();
    const { archive, sha256 } = archiveOf(dir, "bin.tar.gz", {
      "munim-computer-use": "#!/bin/sh\n",
    });
    const manifest = manifestWith({ "linux-x64": { name: "bin.tar.gz", sha256 } });
    let downloads = 0;
    const options = {
      manifest,
      key: "linux-x64" as const,
      environment: { MTCODE_COMPUTER_USE_CACHE: NodePath.join(dir, "cache") },
      download: async (url: string, destination: string) => {
        downloads += 1;
        assert.equal(
          url,
          "https://github.com/munimtechnologies/munim-computer-use/releases/download/v9.9.9/bin.tar.gz",
        );
        NodeFS.copyFileSync(archive, destination);
      },
    };
    const first = await fetchPinnedAsset(options);
    assert.equal(first, NodePath.join(dir, "cache", "9.9.9", "linux-x64"));
    assert.ok(NodeFS.existsSync(NodePath.join(first, "munim-computer-use")));
    await fetchPinnedAsset(options);
    assert.equal(downloads, 1);
  });

  it("rejects an archive whose sha256 does not match the pin", async () => {
    const dir = scratch();
    const { archive } = archiveOf(dir, "bin.tar.gz", { "munim-computer-use": "tampered" });
    const error = await fetchPinnedAsset({
      manifest: manifestWith({ "linux-x64": { name: "bin.tar.gz", sha256: "0".repeat(64) } }),
      key: "linux-x64",
      environment: { MTCODE_COMPUTER_USE_CACHE: NodePath.join(dir, "cache") },
      download: async (_url, destination) => NodeFS.copyFileSync(archive, destination),
    }).catch((cause: unknown) => cause);
    assert.match((error as Error).message, /sha256 mismatch/);
    assert.ok(
      !NodeFS.existsSync(NodePath.join(dir, "cache", "9.9.9", "linux-x64", "munim-computer-use")),
    );
  });

  it("stages a local build with MT's agent-cursor app on macOS", async () => {
    const dir = scratch();
    const binary = NodePath.join(dir, "munim-computer-use");
    NodeFS.writeFileSync(binary, "binary");
    const extension = NodePath.join(dir, "extension");
    NodeFS.mkdirSync(extension);
    NodeFS.writeFileSync(NodePath.join(extension, "manifest.json"), "{}");
    const destination = NodePath.join(dir, "stage", "munim-computer-use");

    const staged = await stageMunimComputerUse({
      repoRoot,
      platform: "darwin",
      arch: "arm64",
      destination,
      environment: {
        MTCODE_COMPUTER_USE_BINARY: binary,
        MTCODE_COMPUTER_USE_EXTENSION_DIR: extension,
      },
    });

    assert.equal(staged, NodePath.join(destination, "munim-computer-use"));
    assert.ok(NodeFS.existsSync(NodePath.join(destination, "chrome-extension", "manifest.json")));
    const plist = NodeFS.readFileSync(
      NodePath.join(destination, "MTCodeAgentCursor.app", "Contents", "Info.plist"),
      "utf8",
    );
    assert.include(plist, MTCODE_AGENT_CURSOR_BUNDLE_ID);
    assert.ok(
      NodeFS.existsSync(
        NodePath.join(
          destination,
          "MTCodeAgentCursor.app",
          "Contents",
          "MacOS",
          "MTCodeAgentCursor",
        ),
      ),
    );
  });
});
