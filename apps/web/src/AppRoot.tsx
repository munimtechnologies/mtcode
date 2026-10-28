import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { ComputerTaskHosts } from "./components/computers/ComputerTaskHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import { VoiceSessionProvider } from "./components/voice/VoiceSession";
import { useAppIcon } from "./hooks/useAppIcon";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <AppIconSync />
      <VoiceSessionProvider>
        <RouterProvider router={router} />
        <ComputerTaskHosts />
        <ElectronBrowserHost />
        <QuitHoldOverlay />
      </VoiceSessionProvider>
    </AppAtomRegistryProvider>
  );
}

/**
 * Applies the account's app-icon choice to the running app. Rendered inside the
 * atom registry because the setting lives in server settings, and as a
 * component rather than a hook call so it re-runs on every settings change.
 */
function AppIconSync() {
  useAppIcon();
  return null;
}
