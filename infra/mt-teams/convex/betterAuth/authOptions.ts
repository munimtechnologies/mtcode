import { convexAdapter } from "@convex-dev/better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";

/**
 * Static options used only to derive the model/table mapping and unique
 * fields for the component's adapter API (mirrors the published component's
 * auth-options.ts). Must list the same schema-bearing plugins as the runtime
 * options in ../auth.ts.
 */
export const options = {
  database: convexAdapter({} as any, {} as any),
  emailAndPassword: { enabled: true },
  plugins: [bearer(), organization()],
} satisfies BetterAuthOptions;
