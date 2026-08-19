import { UserButton, useAuth } from "@clerk/react";
import { ExternalLinkIcon, LogInIcon, ServerIcon, SmartphoneIcon } from "lucide-react";

import {
  canEmbedClerkProviderInThisClient,
  useOptionalConnectProviders,
} from "../../cloud/connectProviderContext";
import { providerHasRelay } from "../../cloud/connectProviders";
import { hasClerkPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { T3ConnectUserProfilePage } from "./T3ConnectUserProfilePage";
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
    <UserButton
      appearance={{
        elements: {
          avatarBox: "size-7",
          userButtonTrigger: "rounded-lg p-1 hover:bg-sidebar-row-hover",
        },
      }}
    >
      {showRelayProfile ? (
        <UserButton.UserProfilePage
          label="Mobile clients"
          labelIcon={<SmartphoneIcon className="size-4" />}
          url="mobile-clients"
        >
          <MobileClientsUserProfilePage />
        </UserButton.UserProfilePage>
      ) : null}
      {showRelayProfile ? (
        <UserButton.UserProfilePage
          label={embedded?.label ?? "Connect"}
          labelIcon={<ServerIcon className="size-4" />}
          url="t3-connect"
        >
          <T3ConnectUserProfilePage />
        </UserButton.UserProfilePage>
      ) : null}
    </UserButton>
  );
}

function ConfiguredConnectSidebarSignIn() {
  const connect = useOptionalConnectProviders();
  if (!connect) return null;
  const { providers, embedded, setActiveId } = connect;
  const mt = providers.find((provider) => provider.id === "mt");
  const t3 = providers.find((provider) => provider.id === "t3");
  const clerkReady = Boolean(embedded);

  return (
    <SidebarMenu>
      {mt && clerkReady ? <EmbeddedConnectSignInRow provider={mt} /> : null}
      {t3 ? (
        clerkReady && canEmbedClerkProviderInThisClient(t3) && embedded?.id === "t3" ? (
          <EmbeddedConnectSignInRow provider={t3} />
        ) : (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                setActiveId("t3");
                window.open(t3.hostedAppUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLinkIcon />
              <span>Open T3 Connect</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      ) : null}
    </SidebarMenu>
  );
}

function EmbeddedConnectSignInRow({
  provider,
}: {
  readonly provider: { id: "mt" | "t3"; label: string };
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const connect = useOptionalConnectProviders();
  const embedded = connect?.embedded ?? null;
  const setActiveId = connect?.setActiveId;

  if (!isLoaded || isSignedIn) return null;
  if (embedded && embedded.id !== provider.id) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => {
            setActiveId?.(provider.id);
          }}
        >
          <LogInIcon />
          <span>Sign in to {provider.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={openAuthPrompt}>
        <LogInIcon />
        <span>Sign in to {provider.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
