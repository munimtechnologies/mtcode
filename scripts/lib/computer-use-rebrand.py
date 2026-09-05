#!/usr/bin/env python3
"""Rebrand the exported Computer Use tree: no T3 names in the public repo.

Applied to a fresh copy at mirror time (scripts/personal-publish-computer-use.sh),
never to the monorepo, where MT Code's launcher still resolves `t3-desktop-mcp`.
Token order matters: longer, more specific names first so the generic
`t3-desktop-mcp` replacement cannot eat a path or bundle id.
"""
import os, re, sys

root = sys.argv[1]
DIRS = {"t3-desktop-mcp": "macos", "t3-desktop-mcp-rs": "windows-linux", "t3-chrome-extension": "chrome-extension"}
REPLACEMENTS = [
    # paths that name the sibling directories
    ("../t3-desktop-mcp/.build", "../macos/.build"),
    ("../t3-desktop-mcp-rs/target", "../windows-linux/target"),
    ("native/t3-desktop-mcp-rs", "windows-linux"),
    ("native/t3-desktop-mcp", "macos"),
    ("native/t3-chrome-extension", "chrome-extension"),
    # identifiers
    ("t3-desktop-mcp-bridge", "computer-use-bridge"),
    ("t3-desktop-mcp-rs", "computer-use-native"),
    ("t3-desktop-mcp", "computer-use"),
    ("t3-chrome-extension", "chrome-extension"),
    ("T3AgentCursorOverlay", "MunimAgentCursorOverlay"),
    ("T3AgentCursor", "MunimAgentCursor"),
    ("com.t3tools.t3code.agent-cursor", "com.munimtech.computer-use.agent-cursor"),
    ("com.t3tools.t3code.desktop", "com.munimtech.computer-use.desktop"),
    ("T3CODE_DESKTOP_MCP_PATH", "COMPUTER_USE_PATH"),
    ("T3_DESKTOP_", "COMPUTER_USE_"),
    ("t3-agent-cursor", "munim-agent-cursor"),
    ("__t3AgentCursor", "__munimAgentCursor"),
    ("__t3hide", "__cuhide"),
    ("__t3", "__cu"),
    ("t3-wake", "cu-wake"),
    ("t3-reconnect", "cu-reconnect"),
    ("t3-idx", "cu-idx"),
    ("t3ac-", "cuac-"),
    ("T3 Agent Cursor", "Munim Agent Cursor"),
    ("T3 toolbar logo", "MT toolbar logo"),
    ("T3 logo", "MT logo"),
    ("T3 Code", "MT Code"),
]
TEXT_EXT = {".swift", ".rs", ".js", ".json", ".sh", ".ps1", ".toml", ".md", ".txt", ".yml", ".yaml", ".lock", ".cjs", ".mjs", ".html", ".css", ".plist", ".dockerfile", ""}

for old, new in DIRS.items():
    src, dst = os.path.join(root, old), os.path.join(root, new)
    if os.path.isdir(src):
        os.rename(src, dst)

changed = 0
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in {".git", ".build", "target", "node_modules"}]
    for name in filenames:
        path = os.path.join(dirpath, name)
        ext = os.path.splitext(name)[1].lower()
        if ext not in TEXT_EXT and name not in {"Dockerfile"}:
            continue
        try:
            data = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        out = data
        for old, new in REPLACEMENTS:
            out = out.replace(old, new)
        if out != data:
            open(path, "w", encoding="utf-8").write(out)
            changed += 1
        # the Swift package directory used to carry the target name; files named after it too
        if "t3-desktop-mcp" in name:
            os.rename(path, os.path.join(dirpath, name.replace("t3-desktop-mcp", "computer-use")))

leftovers = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in {".git", ".build", "target", "node_modules"}]
    for name in filenames:
        path = os.path.join(dirpath, name)
        try:
            data = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for m in re.finditer(r"\b[tT]3(?![0-9])[A-Za-z_.-]*", data):
            leftovers.append(f"{os.path.relpath(path, root)}: {m.group(0)}")
print(f"rebranded {changed} files")
if leftovers:
    print("T3 tokens left:\n  " + "\n  ".join(sorted(set(leftovers))[:40]))
    sys.exit(1)
