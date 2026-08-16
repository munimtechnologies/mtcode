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

export function loadDesktopProtocolUrl(
  window: { readonly loadURL: (url: string) => unknown },
  url: string,
): void {
  void Promise.resolve(window.loadURL(url)).catch(() => undefined);
}

// Latest protocol URL received before a real main window exists (cold launch
// or WSL connecting splash). DesktopWindow.createMain applies it after setMain.
let pendingDesktopProtocolUrl: string | null = null;

export function queuePendingDesktopProtocolUrl(url: string): void {
  pendingDesktopProtocolUrl = url;
}

export function takePendingDesktopProtocolUrl(): string | null {
  const url = pendingDesktopProtocolUrl;
  pendingDesktopProtocolUrl = null;
  return url;
}

export function applyPendingDesktopProtocolUrl(window: {
  readonly loadURL: (url: string) => unknown;
}): boolean {
  const url = takePendingDesktopProtocolUrl();
  if (url === null) {
    return false;
  }
  loadDesktopProtocolUrl(window, url);
  return true;
}
