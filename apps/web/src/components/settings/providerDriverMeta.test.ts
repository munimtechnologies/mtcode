import { describe, expect, it } from "vite-plus/test";

import { DRIVER_OPTIONS } from "./providerDriverMeta";

describe("DRIVER_OPTIONS", () => {
  it("lists each provider driver once", () => {
    const values = DRIVER_OPTIONS.map((option) => option.value);
    expect(values).toEqual([...new Set(values)]);
  });
});
