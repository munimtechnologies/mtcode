import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { ConnectProvidersRoot, useConnectProviders } from "./cloud/connectProviderContext";
import { providerHasRelay } from "./cloud/connectProviders";
import { hasClerkPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

// MT Code keeps the fork's connect-provider Clerk gate (the key may come from an
// embedded provider at runtime), but the Clerk runtime itself is a split chunk
// like upstream: nothing Clerk-related sits in the startup graph for local-mode
// users.
const ConnectClerkGate = React.lazy(() => import("./components/clerk/ConnectClerkGate"));

const envClerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function ClerkGate({ children }: { readonly children: React.ReactNode }) {
  const { embedded } = useConnectProviders();
  const publishableKey = embedded?.clerkPublishableKey ?? envClerkPublishableKey;
  const enableClerk = Boolean(publishableKey && (embedded || hasClerkPublicConfig()));
  const wrapRelay = Boolean(embedded && providerHasRelay(embedded));

  if (!enableClerk || !publishableKey) {
    return children;
  }

  return (
    <React.Suspense fallback={null}>
      <ConnectClerkGate
        key={embedded?.id ?? "clerk"}
        publishableKey={publishableKey}
        wrapRelay={wrapRelay}
      >
        {children}
      </ConnectClerkGate>
    </React.Suspense>
  );
}

// A failed split-chunk fetch usually means the hashed assets went stale under
// a deploy; one guarded reload picks up the fresh index.html.
let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

// When Clerk is configured statically, resolve its chunk before the first
// commit too, so the boot splash holds until real UI paints (same reasoning as
// the route chunks below). An embedded provider that enables Clerk later goes
// through the gate's Suspense boundary instead.
const clerkGateModule =
  envClerkPublishableKey && hasClerkPublicConfig()
    ? import("./components/clerk/ConnectClerkGate")
    : null;

// The index.html boot splash lives inside #root, and React's first commit
// clears it. Resolve everything that first commit needs, the selected
// managed-auth runtime and the initial route's split chunks, before
// rendering, so the splash holds until real UI paints instead of dropping to
// a blank window while chunks download.
export const startup = Promise.all([clerkGateModule, router.load()])
  .then(() => {
    // A route chunk failure still resolves router.load(): the error is parked in
    // the lazy component and surfaces through the route error boundary. Skip the
    // paint when a reload is on its way, and only re-arm the guard after a boot
    // that fetched every chunk it asked for.
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <ConnectProvidersRoot>
          <ClerkGate>{app}</ClerkGate>
        </ConnectProvidersRoot>
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    // Let the bootstrap entry show the error unless a reload is already scheduled.
    if (reloadScheduled) return;
    console.error("MT Code failed to load its startup chunks.", error);
    const bootShell = document.getElementById("boot-shell");
    if (bootShell) bootShell.textContent = "MT Code could not load. Reload to try again.";
  });
