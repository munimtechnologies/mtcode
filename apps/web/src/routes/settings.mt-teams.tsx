import { createFileRoute } from "@tanstack/react-router";

import { MtTeamsSettingsPage } from "../mtTeams/MtTeamsSettings";

export const Route = createFileRoute("/settings/mt-teams")({
  component: MtTeamsSettingsPage,
});
