import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { Platform } from "react-native";

import { getMobileClientLabel } from "./branding";

export function authClientMetadata(): AuthClientPresentationMetadata {
  return {
    label: getMobileClientLabel(),
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
  };
}
