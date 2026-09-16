import { useEffect, type ReactNode } from "react";

import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { setSelfHostedNotificationConnections } from "./selfHostedNotifications";

export function SelfHostedNotificationsProvider(props: { readonly children: ReactNode }) {
  const { savedConnectionsById } = useSavedRemoteConnections();

  useEffect(() => {
    setSelfHostedNotificationConnections(Object.values(savedConnectionsById));
  }, [savedConnectionsById]);

  return props.children;
}
