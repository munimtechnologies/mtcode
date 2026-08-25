import { defineComponent } from "convex/server";

// Local install of the Better Auth component so the schema can include the
// organization plugin's tables (organization/member/invitation), which the
// published component's schema does not carry.
const component = defineComponent("betterAuth");

export default component;
