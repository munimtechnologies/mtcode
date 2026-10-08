/**
 * MT Code: the product name lives in provider-core so provider packages (text
 * generation prompts, managed providers) can use it without importing the server.
 *
 * @module appDisplayName
 */
export {
  DEFAULT_APP_DISPLAY_NAME,
  providerDisabledMessage,
  resolveAppDisplayName,
} from "@t3tools/provider-core/server/appDisplayName";
