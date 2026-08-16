// Used by second-instance argv and macOS open-url to find the custom-scheme
// URL the already-running desktop window should load.
export function isDesktopProtocolUrl(value: string, scheme: string): boolean {
  return value.startsWith(`${scheme}://`);
}

export function extractDesktopProtocolUrl(argv: readonly string[], scheme: string): string | null {
  let found: string | null = null;
  for (const arg of argv) {
    if (arg.length === 0 || arg.startsWith("-") || !isDesktopProtocolUrl(arg, scheme)) {
      continue;
    }
    found = arg;
  }
  return found;
}
