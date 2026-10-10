// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { collapseHomePath, expandHomePath } from "./pathExpansion.ts";

const home = "/home/ada";

describe("expandHomePath", () => {
  it("returns an empty string unchanged", () => {
    expect(expandHomePath("", home)).toBe("");
  });

  it("returns paths without a leading tilde unchanged", () => {
    expect(expandHomePath("/absolute/path", home)).toBe("/absolute/path");
    expect(expandHomePath("relative/path", home)).toBe("relative/path");
    expect(expandHomePath("some~weird~path", home)).toBe("some~weird~path");
  });

  it("expands a lone tilde to the home directory", () => {
    expect(expandHomePath("~", home)).toBe(home);
  });

  it("expands ~/ to a subpath of the home directory", () => {
    expect(expandHomePath("~/.codex-work", home)).toBe(NodePath.join(home, ".codex-work"));
  });

  it("expands a Windows-style ~\\ prefix", () => {
    expect(expandHomePath("~\\.codex", home)).toBe(NodePath.join(home, ".codex"));
  });

  it("does not expand ~user paths", () => {
    expect(expandHomePath("~alice/foo", home)).toBe("~alice/foo");
  });
});

describe("collapseHomePath", () => {
  it("shows the home directory itself as a tilde", () => {
    expect(collapseHomePath(home, home)).toBe("~");
  });

  it("replaces a home prefix and keeps the rest of the path", () => {
    expect(collapseHomePath(NodePath.join(home, ".t3", "worktrees"), home)).toBe(
      NodePath.join("~", ".t3", "worktrees"),
    );
  });

  it("leaves paths outside home and home-prefixed siblings unchanged", () => {
    expect(collapseHomePath("/srv/worktrees", home)).toBe("/srv/worktrees");
    expect(collapseHomePath(`${home}-other`, home)).toBe(`${home}-other`);
  });
});
