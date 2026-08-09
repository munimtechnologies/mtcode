import { assert, it } from "@effect/vitest";

import { formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  kind: "systemd",
  unitPath: "/home/me/.config/systemd/user/t3code.service",
  logPath: "/home/me/.t3/userdata/logs/boot-service.log",
} as const;

const windowsStatus = {
  ...status,
  kind: "win32-startup-shortcut",
  unitPath:
    "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\T3 Code Server.lnk",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "T3 Code service",
      "  Status: installed · t3@0.0.29",
      "  Unit: /home/me/.config/systemd/user/t3code.service",
      "  Logs: /home/me/.t3/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Next: Run `npx t3@latest service update`.",
  );
});

it("explains where the service is supported", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Supported on: Linux with systemd, macOS with launchd, or Windows",
  );
});

it("calls the Windows definition a shortcut, not a unit", () => {
  const output = formatServiceStatus(windowsStatus, "0.0.29");
  assert.include(output, `  Shortcut: ${windowsStatus.unitPath}`);
  assert.notInclude(output, "Unit:");
});

it("calls the macOS definition a LaunchAgent, not a unit", () => {
  const output = formatServiceStatus(
    {
      ...status,
      kind: "launchd",
      unitPath: "/Users/me/Library/LaunchAgents/com.t3tools.t3code.service.plist",
    },
    "0.0.29",
  );
  assert.include(output, "  LaunchAgent:");
  assert.notInclude(output, "Unit:");
  assert.notInclude(output, "Shortcut:");
});
