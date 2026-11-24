/**
 * The picker preload runs in its own JavaScript world; PageWorld.ts holds what must run in the page's.
 * Keep it whitespace-free with `true`/`false` values: Electron's parser does not trim keys, and
 * `"no"` is a truthy string. DesktopWindow's `will-attach-webview` handler also forces these flags.
 */
export const PREVIEW_WEBVIEW_PREFERENCES =
  "contextIsolation=true,sandbox=true,nodeIntegration=false";
