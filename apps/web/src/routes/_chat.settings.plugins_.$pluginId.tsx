import { createFileRoute } from "@tanstack/react-router";

import { PluginDetail } from "../components/settings/pluginMarketplace/PluginDetail";

export const Route = createFileRoute("/_chat/settings/plugins_/$pluginId")({
  component: () => <PluginDetail pluginId={Route.useParams().pluginId} />,
});
