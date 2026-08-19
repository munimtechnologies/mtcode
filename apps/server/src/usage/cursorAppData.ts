/**
 * Whether this machine's configuration justifies reading Cursor's own data.
 *
 * Cursor's usage export and dashboard session live under Cursor's
 * application-support directory. macOS guards another app's data behind an
 * "access data from other apps" prompt, so nothing reads it on behalf of
 * someone who has the Cursor driver switched off.
 *
 * @module usage/cursorAppData
 */
import { resolveProviderInstanceEnabled, type ProviderInstanceConfigMap } from "@t3tools/contracts";

/** True when at least one configured instance runs the Cursor driver and is on. */
export function hasEnabledCursorInstance(configMap: ProviderInstanceConfigMap): boolean {
  return Object.values(configMap).some(
    (instance) => instance.driver === "cursor" && resolveProviderInstanceEnabled(instance),
  );
}
