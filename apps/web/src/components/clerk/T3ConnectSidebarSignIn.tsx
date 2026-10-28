import { UserButton, useAuth } from "@clerk/react";
import { ExternalLinkIcon, LogInIcon } from "lucide-react";

import {
  canEmbedClerkProviderInThisClient,
  useOptionalConnectProviders,
} from "../../cloud/connectProviderContext";
import { providerHasRelay, type ConnectProviderPublicConfig } from "../../cloud/connectProviders";
import { hasClerkPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { T3_CONNECT_ACCOUNT_PAGES } from "./T3ConnectAccountPages";
import { useT3ConnectAuthPrompt } from "./useT3ConnectAuthPrompt";

export function T3ConnectSidebarSignIn() {
  const connect = useOptionalConnectProviders();
  if (!connect) return null;
  if (connect.providers.length === 0 && !hasClerkPublicConfig()) return null;
  return <ConfiguredConnectSidebarSignIn />;
}

export function T3ConnectSidebarAvatar() {
  const connect = useOptionalConnectProviders();
  if (!connect?.embedded) return null;
  return <ConfiguredConnectSidebarAvatar />;
}

function ConfiguredConnectSidebarAvatar() {
  const { isLoaded, isSignedIn } = useAuth();
  const connect = useOptionalConnectProviders();
  const embedded = connect?.embedded ?? null;
  const showRelayProfile = providerHasRelay(embedded);

  if (!isLoaded || !isSignedIn) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "size-7",
            // Clerk's unlayered trigger reset (padding, radius, background) beats layered utilities.
            userButtonTrigger: "mb-1! rounded-lg! p-1! hover:bg-sidebar-row-hover!",
          },
        }}
      >
        {showRelayProfile
          ? T3_CONNECT_ACCOUNT_PAGES.map((page) => (
              <UserButton.UserProfilePage
                key={page.url}
                label={page.url === "t3-connect" ? (embedded?.label ?? "Connect") : page.label}
                labelIcon={page.icon}
                url={page.url}
              >
                {page.content}
              </UserButton.UserProfilePage>
            ))
          : null}
      </UserButton>
    </div>
  );
}

function ConfiguredConnectSidebarSignIn() {
  const connect = useOptionalConnectProviders();
  if (!connect) return null;
  const { providers, embedded } = connect;
  const t3 = providers.find((provider) => provider.id === "t3");
  // Auth UI follows the Clerk instance that is actually mounted — never a
  // persisted preference for a provider that cannot embed on this origin.
  const signedInProvider = embedded;

  return (
    <SidebarMenu>
      {signedInProvider ? <EmbeddedConnectSignInRow provider={signedInProvider} /> : null}
      {t3 && !canEmbedClerkProviderInThisClient(t3) && t3.hostedAppUrl ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => {
              window.open(t3.hostedAppUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLinkIcon />
            <span>Open {t3.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}

function EmbeddedConnectSignInRow({
  provider,
}: {
  readonly provider: Pick<ConnectProviderPublicConfig, "id" | "label">;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();

  if (!isLoaded || isSignedIn) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={openAuthPrompt}>
        <LogInIcon />
        <span>Sign in to {provider.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
