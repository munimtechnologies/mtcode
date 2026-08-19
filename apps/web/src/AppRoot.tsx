import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { ComputerTaskHosts } from "./components/computers/ComputerTaskHosts";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import { VoiceSessionProvider } from "./components/voice/VoiceSession";
import { useAppIcon } from "./hooks/useAppIcon";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <AppIconSync />
      <VoiceSessionProvider>
        <RouterProvider router={router} />
        <PreviewAutomationHosts />
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
