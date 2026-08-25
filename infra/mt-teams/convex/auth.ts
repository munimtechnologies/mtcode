import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { bearer, organization } from "better-auth/plugins";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import schema from "./betterAuth/schema";

export const authComponent = createClient<DataModel, typeof schema>(components.betterAuth, {
  local: { schema },
});

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    appName: "MT Teams",
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    // Clients call from arbitrary origins (app origin, localhost, LAN) and
    // authenticate with explicit bearer tokens rather than cookies, so the
    // origin-based CSRF check is disabled.
    advanced: {
      disableCSRFCheck: true,
    },
    plugins: [bearer(), organization(), convex({ authConfig })],
  });
};
