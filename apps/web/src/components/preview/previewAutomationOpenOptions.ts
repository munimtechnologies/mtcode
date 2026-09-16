import { findBrowserProfile, type PreviewAutomationOpenInput } from "@t3tools/contracts";

import {
  type BrowserDefaults,
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
} from "~/browser/browserDefaults";

import { PreviewAutomationProfileNotFoundError } from "./previewAutomationErrors";

/**
 * The `preview.open` options for an agent-initiated tab. An agent that didn't
 * state a size or profile gets the user's configured defaults, same as a
 * hand-opened tab; a named profile must already exist on this desktop.
 */
export function previewAutomationOpenOptions(
  input: PreviewAutomationOpenInput,
  defaults: BrowserDefaults,
) {
  if (input.profileId !== undefined && !findBrowserProfile(defaults.profiles, input.profileId)) {
    throw new PreviewAutomationProfileNotFoundError({ profileId: input.profileId });
  }
  return {
    viewport: browserDefaultOpenViewport(defaults),
    profileId: input.profileId ?? browserDefaultOpenProfileId(defaults),
  };
}
