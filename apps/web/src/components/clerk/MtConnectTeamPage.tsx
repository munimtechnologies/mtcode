import { useAuth, useClerk, useOrganization } from "@clerk/react";
import { Building2Icon } from "lucide-react";

import { Button } from "../ui/button";
import { ClerkUserProfilePage, ClerkUserProfileRow } from "./ClerkUserProfilePage";

export function MtConnectTeamPage() {
  const clerk = useClerk();
  const { organization } = useOrganization();
  const { has } = useAuth();
  const onTeam = Boolean(has?.({ plan: "org:team" }));

  return (
    <ClerkUserProfilePage
      title="Team"
      description="Personal machines stay free. You pay when other people join a workspace or when a computer is in the shared team pool."
      action={
        <Button
          size="sm"
          variant="outline"
          className="text-[0.8125rem]"
          onClick={() => {
            if (organization) {
              void clerk.openOrganizationProfile();
              return;
            }
            void clerk.openCreateOrganization();
          }}
        >
          {organization ? "Manage billing" : "Create team"}
        </Button>
      }
    >
      <ul className="border-t">
        <ClerkUserProfileRow icon={<Building2Icon className="size-4" />}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[0.8125rem] leading-[1.125rem] font-medium text-foreground">
              {organization ? organization.name : "No workspace yet"}
            </h3>
            <p className="mt-1 text-xs leading-[1.125rem] text-muted-foreground">
              {onTeam
                ? "Team plan — members plus three shared computers. Extra computers are $4/month each, billed to Munim Inc via Stripe."
                : "Personal plan — you and the machines you pair yourself. Upgrade in Manage billing to invite people or share a computer pool."}
            </p>
          </div>
        </ClerkUserProfileRow>
      </ul>
    </ClerkUserProfilePage>
  );
}
