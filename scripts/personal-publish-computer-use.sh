#!/usr/bin/env bash
# Mirror the Computer Use MCP server to the public munimtechnologies/computer-use repo.
#
# A snapshot mirror, not a subtree split: `native/` also holds unrelated
# packages, and a fresh copy per sync keeps the public tree exactly the three
# directories plus README/LICENSE. History in the mirror is one commit per sync,
# each naming the monorepo commit it came from.
set -euo pipefail

REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
MIRROR="${COMPUTER_USE_REPO:-munimtechnologies/computer-use}"
WORK=$(mktemp -d /tmp/computer-use.XXXXXX)
if [[ -z "${COMPUTER_USE_KEEP_WORK:-}" ]]; then trap 'rm -rf "$WORK"' EXIT; else echo "export kept at $WORK"; fi

cd "$REPO"
SHA=$(git rev-parse --short HEAD)

if ! gh repo view "$MIRROR" >/dev/null 2>&1; then
  gh repo create "$MIRROR" --public \
    --description "Open-source Computer Use MCP server for any coding agent — macOS, Windows, Linux. From MT Code." \
    --homepage "https://munimtech.com/computer-use"
fi
git clone -q "https://github.com/$MIRROR.git" "$WORK/mirror"
cd "$WORK/mirror"
git rm -rq --ignore-unmatch . >/dev/null 2>&1 || true
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

for dir in t3-desktop-mcp t3-desktop-mcp-rs t3-chrome-extension; do
  rsync -a --exclude '.build' --exclude 'target' --exclude 'node_modules' \
    "$REPO/native/$dir/" "$WORK/mirror/$dir/"
done
# The public tree carries no T3 names: directories, binary, env vars and bundle
# ids are rebranded on the copy (see scripts/lib/computer-use-rebrand.py).
python3 "$REPO/scripts/lib/computer-use-rebrand.py" "$WORK/mirror"
cp "$REPO/native/computer-use/README.md" README.md
cp "$REPO/native/computer-use/LICENSE" LICENSE
cp "$REPO/native/computer-use/server.json" server.json
mkdir -p .github/workflows npm/bin
cp "$REPO/native/computer-use/.github/workflows/publish-mcp.yml" .github/workflows/publish-mcp.yml
cp "$REPO/native/computer-use/npm/package.json" "$REPO/native/computer-use/npm/README.md" npm/
cp "$REPO/native/computer-use/npm/bin/computer-use.js" npm/bin/computer-use.js
cat > .gitignore <<'GI'
macos/.build/
windows-linux/target/
GI

git add -A
if git diff --cached --quiet; then
  echo "mirror already up to date with mtcode@$SHA"
  exit 0
fi
git -c user.name="Sheehan Munim" -c user.email="sheehanmunim@gmail.com" \
  commit -q -m "sync from munimtechnologies/mtcode@$SHA"
git push -q origin HEAD:main 2>/dev/null || git push -q -u origin HEAD:main
echo "published https://github.com/$MIRROR at mtcode@$SHA"
