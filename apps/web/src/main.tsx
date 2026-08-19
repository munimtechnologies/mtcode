import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { ConnectProvidersRoot, useConnectProviders } from "./cloud/connectProviderContext";
import { providerHasRelay } from "./cloud/connectProviders";
import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { hasClerkPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { clerkAppearance } from "./components/clerk/clerkAppearance";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

// Autofill support makes clerk-js fire a passkey retrieval as soon as the
// sign-in modal opens, which fails in the desktop shell and surfaces an error
// banner before the user has done anything. Report it unsupported so passkeys
// only run from the explicit "Use passkey instead" action.
const manualOnlyPasskeys: typeof passkeys = {
  ...passkeys,
  isAutoFillSupported: () => Promise.resolve(false),
};

function ClerkGate({ children }: { readonly children: React.ReactNode }) {
  const { embedded } = useConnectProviders();
  const publishableKey =
    embedded?.clerkPublishableKey ??
    (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined);
  const enableClerk = Boolean(publishableKey && (embedded || hasClerkPublicConfig()));
  const wrapRelay = Boolean(embedded && providerHasRelay(embedded));

  if (!enableClerk || !publishableKey) {
    return children;
  }

  const inner = wrapRelay ? (
    <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider>
  ) : (
    children
  );

  if (isElectron) {
    return (
      <ElectronClerkProvider
        key={embedded?.id ?? "clerk"}
        appearance={clerkAppearance}
        publishableKey={publishableKey}
        passkeys={manualOnlyPasskeys}
      >
        {inner}
      </ElectronClerkProvider>
    );
  }

  return (
    <ClerkProvider
      key={embedded?.id ?? "clerk"}
      appearance={clerkAppearance}
      publishableKey={publishableKey}
    >
      {inner}
    </ClerkProvider>
  );
}

const app = <AppRoot router={router} />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConnectProvidersRoot>
      <ClerkGate>{app}</ClerkGate>
    </ConnectProvidersRoot>
  </React.StrictMode>,
);
