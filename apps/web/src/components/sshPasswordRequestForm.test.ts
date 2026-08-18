import { describe, expect, it } from "@effect/vitest";

import { canSubmitSshPassword } from "./sshPasswordRequestForm";

describe("SSH password request form", () => {
  it("requires a non-empty password for an active prompt", () => {
    expect(canSubmitSshPassword({ password: "", isResponding: false, isExpired: false })).toBe(
      false,
    );
    expect(canSubmitSshPassword({ password: "secret", isResponding: true, isExpired: false })).toBe(
      false,
    );
    expect(canSubmitSshPassword({ password: "secret", isResponding: false, isExpired: true })).toBe(
      false,
    );
    expect(
      canSubmitSshPassword({ password: "secret", isResponding: false, isExpired: false }),
    ).toBe(true);
  });
});
