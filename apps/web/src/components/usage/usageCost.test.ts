import { formatUsageCost } from "@t3tools/shared/usageFormat";
import { describe, expect, it } from "vite-plus/test";

describe("formatUsageCost", () => {
  it("does not present a missing rate table as $0.00", () => {
    expect(formatUsageCost("unavailable", 0)).toBe("Cost unavailable");
  });

  it("keeps a genuine zero when rates loaded", () => {
    expect(formatUsageCost("fresh", 0)).toBe("$0.00");
  });

  it("formats a fresh dollar amount", () => {
    expect(formatUsageCost("fresh", 12.3)).toBe("$12.30");
  });

  it("formats a cached dollar amount", () => {
    expect(formatUsageCost("cached", 4.5)).toBe("$4.50");
  });
});
