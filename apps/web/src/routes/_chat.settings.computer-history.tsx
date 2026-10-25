import { createFileRoute } from "@tanstack/react-router";

import { ComputerHistorySettings } from "../components/settings/ComputerHistorySettings";

export const Route = createFileRoute("/_chat/settings/computer-history")({
  component: ComputerHistorySettings,
});
