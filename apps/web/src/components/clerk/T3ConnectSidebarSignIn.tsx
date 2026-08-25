import { OrganizationSwitcher, UserButton, useAuth } from "@clerk/react";
import {
  Building2Icon,
  ExternalLinkIcon,
  LogInIcon,
  ServerIcon,
  SmartphoneIcon,
} from "lucide-react";

import {
  canEmbedClerkProviderInThisClient,
  useOptionalConnectProviders,
} from "../../cloud/connectProviderContext";
import { providerHasRelay, type ConnectProviderPublicConfig } from "../../cloud/connectProviders";
import { hasClerkPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { MtConnectTeamPage } from "./MtConnectTeamPage";
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

  const isMtConnect = embedded?.id === "mt";

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isMtConnect ? (
        <OrganizationSwitcher
          createOrganizationMode="modal"
          organizationProfileMode="modal"
          appearance={{
            elements: {
              rootBox: "flex items-center",
              organizationSwitcherTrigger: "size-7 rounded-lg p-0.5 hover:bg-sidebar-row-hover",
            },
          }}
        />
      ) : null}
      <UserButton
        appearance={{
          elements: {
            avatarBox: "size-7",
            userButtonTrigger: "rounded-lg p-1 hover:bg-sidebar-row-hover",
          },
        }}
      >
        {isMtConnect ? (
          <UserButton.UserProfilePage
            label="Team"
            labelIcon={<Building2Icon className="size-4" />}
            url="team"
          >
            <MtConnectTeamPage />
          </UserButton.UserProfilePage>
        ) : null}
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
    </div>
  );
}

function ConfiguredConnectSidebarSignIn() {
  const connect = useOptionalConnectProviders();
  if (!connect) return null;
  const { providers, embedded, setActiveId } = connect;
  const mt = providers.find((provider) => provider.id === "mt");
  const t3 = providers.find((provider) => provider.id === "t3");
  // Auth UI follows the Clerk instance that is actually mounted — never a
  // persisted preference for a provider that cannot embed on this origin.
  const signedInProvider = embedded;

  return (
    <SidebarMenu>
      {signedInProvider ? <EmbeddedConnectSignInRow provider={signedInProvider} /> : null}
      {mt && t3 && signedInProvider?.id === "mt" && canEmbedClerkProviderInThisClient(t3) ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => {
              setActiveId("t3");
            }}
          >
            <LogInIcon />
            <span>Use {t3.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      {mt && t3 && signedInProvider?.id === "t3" && canEmbedClerkProviderInThisClient(mt) ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => {
              setActiveId("mt");
            }}
          >
            <LogInIcon />
            <span>Use {mt.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
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
