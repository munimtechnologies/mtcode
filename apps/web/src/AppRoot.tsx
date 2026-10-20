import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import { subscribeComposerDraftModelReconciliation } from "./composerDraftStore";
import { environmentThreadShells } from "./state/threads";
import { environmentShell } from "./state/shell";

import { BrowserProfileReporter } from "./browser/BrowserProfileReporter";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { ComputerTaskHosts } from "./components/computers/ComputerTaskHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { appAtomRegistry, AppAtomRegistryProvider } from "./rpc/atomRegistry";
import { VoiceSessionProvider } from "./components/voice/VoiceSession";
import { useAppIcon } from "./hooks/useAppIcon";
import type { AppRouter } from "./router";

/**
 * The Electron browser host intentionally sits outside the router so its
 * webviews survive route transitions, but it must share the same atom registry
 * as routed UI.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  useEffect(
    () =>
      subscribeComposerDraftModelReconciliation({
        registry: appAtomRegistry,
        threadShellAtom: environmentThreadShells.threadShellAtom,
        threadRefsAtom: environmentThreadShells.threadRefsAtom,
        shellStateAtom: environmentShell.stateAtom,
      }),
    [],
  );
  return (
    <AppAtomRegistryProvider>
      <AppIconSync />
      <VoiceSessionProvider>
        <RouterProvider router={router} />
        <ComputerTaskHosts />
        <ElectronBrowserHost />
        <BrowserProfileReporter />
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
