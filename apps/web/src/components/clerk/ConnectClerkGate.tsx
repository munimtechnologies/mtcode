import { ClerkProvider } from "@clerk/react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import type { ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";
import { isElectron } from "../../env";
import { clerkAppearance } from "./clerkAppearance";

/**
 * MT Code's Clerk boundary. Mirrors upstream's Browser/ElectronManagedAuthShell
 * split (the Electron provider statically bundles clerk-js, so this module must
 * only ever load lazily) but keeps the fork's connect-provider semantics: the
 * publishable key may come from an embedded provider at runtime, and the relay
 * auth wrapper is only applied when that provider actually has a relay.
 */
export default function ConnectClerkGate({
  publishableKey,
  wrapRelay,
  children,
}: {
  readonly publishableKey: string;
  readonly wrapRelay: boolean;
  readonly children: ReactNode;
}) {
  const inner = wrapRelay ? (
    <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider>
  ) : (
    children
  );

  if (isElectron) {
    return (
      <ElectronClerkProvider
        appearance={clerkAppearance}
        publishableKey={publishableKey}
        passkeys={passkeys}
      >
        {inner}
      </ElectronClerkProvider>
    );
  }

  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey}>
      {inner}
    </ClerkProvider>
  );
}
