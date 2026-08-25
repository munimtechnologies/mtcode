/**
 * The "MT Teams" row on the Settings screen. Lives here so the mount in
 * SettingsRouteScreen stays one line. Hidden entirely when the build carries
 * no team service origin. The value slot doubles as a cheap invite badge: it
 * reads the store snapshot without starting the poll (the MT Teams screen and
 * Team shelf own syncing), so it shows the latest known pending-invite count.
 */
import { useNavigation } from "@react-navigation/native";

import { SettingsRow } from "../features/settings/components/SettingsRow";
import { isMtTeamsConfigured, useMtTeamsSelector } from "./state";

export function MtTeamsSettingsRow() {
  const navigation = useNavigation();
  const inviteCount = useMtTeamsSelector((state) => state.myInvites.length);
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);

  if (!isMtTeamsConfigured()) return null;

  return (
    <SettingsRow
      // person.crop.circle is the only person icon with an Android fallback
      // in AppSymbol's map; unmapped SF names render as a blank slot there.
      icon="person.crop.circle"
      label="MT Teams"
      value={
        inviteCount > 0
          ? `${inviteCount} invite${inviteCount === 1 ? "" : "s"}`
          : signedIn
            ? undefined
            : "Sign in"
      }
      onPress={() =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "SettingsMtTeams" },
        })
      }
    />
  );
}
