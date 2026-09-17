import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import type { SavedRemoteConnection } from "../../lib/connection";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";

export type SelfHostedNotificationStatus = "checking" | "enabled" | "disabled" | "unsupported";

const connections = new Map<string, SavedRemoteConnection>();
const listeners = new Set<() => void>();
let status: SelfHostedNotificationStatus = "checking";
let foregroundSubscription: { remove: () => void } | null = null;

function setStatus(next: SelfHostedNotificationStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener();
}

export function getSelfHostedNotificationStatus(): SelfHostedNotificationStatus {
  return status;
}

export function subscribeSelfHostedNotificationStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function projectId(): string | null {
  const value = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("agent-activity", {
    name: "Agent activity",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });
}

async function registerWithConnection(
  connection: SavedRemoteConnection,
  registration: {
    readonly deviceId: string;
    readonly expoPushToken: string;
    readonly label: string;
  },
): Promise<void> {
  if (!connection.bearerToken || connection.relayManaged) return;
  const response = await fetch(
    `${connection.httpBaseUrl.replace(/\/+$/, "")}/api/notifications/device`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(registration),
    },
  );
  if (!response.ok) throw new Error(`Device registration failed (${response.status})`);
}

export async function refreshSelfHostedNotificationRegistration(): Promise<void> {
  if (Platform.OS !== "android") {
    setStatus("unsupported");
    return;
  }
  await ensureAndroidChannel();
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    setStatus("disabled");
    return;
  }
  const easProjectId = projectId();
  if (!easProjectId) {
    setStatus("unsupported");
    return;
  }
  const [deviceId, token] = await Promise.all([
    loadOrCreateAgentAwarenessDeviceId(),
    Notifications.getExpoPushTokenAsync({ projectId: easProjectId }),
  ]);
  await Promise.all(
    [...connections.values()].map((connection) =>
      registerWithConnection(connection, {
        deviceId,
        expoPushToken: token.data,
        label: Constants.deviceName?.trim() || "Android device",
      }),
    ),
  );
  setStatus("enabled");
}

export async function requestSelfHostedNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  await ensureAndroidChannel();
  const result = await Notifications.requestPermissionsAsync();
  if (!result.granted) {
    setStatus("disabled");
    return false;
  }
  await refreshSelfHostedNotificationRegistration();
  return true;
}

export function setSelfHostedNotificationConnections(
  next: ReadonlyArray<SavedRemoteConnection>,
): void {
  connections.clear();
  for (const connection of next) connections.set(connection.environmentId, connection);
  void refreshSelfHostedNotificationRegistration().catch((error: unknown) => {
    console.error("Self-hosted notification registration failed", error);
  });
  if (!foregroundSubscription) {
    foregroundSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshSelfHostedNotificationRegistration().catch((error: unknown) => {
          console.error("Self-hosted notification refresh failed", error);
        });
      }
    });
  }
}
