#!/bin/sh
# Register the native messaging host so Chrome can reach the desktop server.
#
# Chrome runs the host itself and passes no arguments, so it points at a small
# wrapper that re-execs the server binary in host mode. The extension id is
# pinned by the "key" in manifest.json, which is why this can be registered
# before the extension is ever loaded.
set -eu

EXTENSION_ID="kgdolgnijopbghhomnblabjkmjhnoage"
HOST_NAME="com.munim.mtcode.desktop"
# Extensions that have not reloaded since the rename still ask for the old id,
# and Chrome refuses a host it has no manifest for. Both names are registered
# so neither side has to be updated first.
LEGACY_HOST_NAME="com.t3tools.t3code.desktop"

here=$(cd "$(dirname "$0")" && pwd)
# macOS builds the Swift package; Linux builds the Rust crate that also covers
# Windows. Either way the binary is called t3-desktop-mcp.
case "$(uname -s)" in
  Darwin)
    for candidate in \
      "$here/../t3-desktop-mcp/.build/apple/Products/Release/t3-desktop-mcp" \
      "$here/../t3-desktop-mcp/.build/release/t3-desktop-mcp"; do
      if [ -x "$candidate" ]; then
        default_binary="$candidate"
        break
      fi
    done
    ;;
  *)      default_binary="$here/../t3-desktop-mcp-rs/target/release/t3-desktop-mcp" ;;
esac
binary="${T3CODE_DESKTOP_MCP_PATH:-$default_binary}"
if [ ! -x "$binary" ]; then
  echo "desktop server binary not found at: $binary" >&2
  echo "build it first:  pnpm build:desktop-mcp" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) support="$HOME/Library/Application Support/t3-desktop-mcp" ;;
  *)      support="${XDG_DATA_HOME:-$HOME/.local/share}/t3-desktop-mcp" ;;
esac
mkdir -p "$support"
wrapper="$support/native-host"
cat > "$wrapper" <<EOF
#!/bin/sh
exec "$binary" native-host
EOF
chmod +x "$wrapper"

# Chrome, Chrome Beta/Canary and Chromium each read their own directory.
case "$(uname -s)" in
  Darwin)
    set -- \
      "$HOME/Library/Application Support/Google/Chrome" \
      "$HOME/Library/Application Support/Google/Chrome Beta" \
      "$HOME/Library/Application Support/Google/Chrome Canary" \
      "$HOME/Library/Application Support/Chromium"
    ;;
  *)
    config="${XDG_CONFIG_HOME:-$HOME/.config}"
    set -- \
      "$config/google-chrome" \
      "$config/google-chrome-beta" \
      "$config/google-chrome-unstable" \
      "$config/chromium"
    ;;
esac

installed=0
for profile in "$@"; do
  [ -d "$profile" ] || continue
  dir="$profile/NativeMessagingHosts"
  mkdir -p "$dir"
  for host_name in "$HOST_NAME" "$LEGACY_HOST_NAME"; do
    cat > "$dir/$host_name.json" <<EOF
{
  "name": "$host_name",
  "description": "MT Code desktop control bridge",
  "path": "$wrapper",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  done
  echo "registered host in: $profile"
  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  echo "no Chrome profile directory found" >&2
  exit 1
fi

echo
echo "Next, load the extension once:"
echo "  1. open  chrome://extensions"
echo "  2. turn on Developer mode"
echo "  3. Load unpacked  ->  $here"
echo
echo "It should appear with id $EXTENSION_ID."
