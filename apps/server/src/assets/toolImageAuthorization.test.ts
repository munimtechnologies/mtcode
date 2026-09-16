import { describe, expect, it } from "vite-plus/test";

import { activityPayloadContainsImagePath } from "./toolImageAuthorization.ts";

describe("activityPayloadContainsImagePath", () => {
  it("finds an exact image path in a nested tool payload", () => {
    const path = "/tmp/agent-session/screenshot.jpeg";

    expect(
      activityPayloadContainsImagePath({ data: { item: { type: "imageView", path } } }, path),
    ).toBe(true);
  });

  it("does not authorize unrelated paths or arbitrary payload text", () => {
    const path = "/tmp/agent-session/screenshot.jpeg";

    expect(
      activityPayloadContainsImagePath({ data: { item: { path: "/tmp/other.jpeg" } } }, path),
    ).toBe(false);
    expect(activityPayloadContainsImagePath({ detail: `Viewed ${path}` }, path)).toBe(false);
    expect(activityPayloadContainsImagePath({ data: { item: { path } } }, "/tmp/secrets.txt")).toBe(
      false,
    );
  });
});
