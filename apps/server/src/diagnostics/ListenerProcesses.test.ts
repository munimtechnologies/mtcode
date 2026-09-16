import { describe, expect, it } from "vite-plus/test";

import { parseCwdOutput, parseElapsed, parsePsOutput } from "./ListenerProcesses.ts";

describe("ListenerProcesses parsing", () => {
  it("reads ps elapsed times in every shape ps prints", () => {
    expect(parseElapsed("00:07")).toBe(7_000);
    expect(parseElapsed("15:07")).toBe(907_000);
    expect(parseElapsed("01:15:07")).toBe(4_507_000);
    expect(parseElapsed("2-01:15:07")).toBe(177_307_000);
    expect(parseElapsed("soon")).toBeNull();
  });

  it("reads ps rows with the command line kept whole", () => {
    const rows = parsePsOutput(
      [
        "61013 61008    15:07  51200  0.5 S+   /usr/bin/deno run --ext=js -A dev.ts",
        "  455     1 01:15:07 204800 12.3 Ss   node server.mjs --port 3001",
        "garbage line",
      ].join("\n"),
    );
    expect(rows.get(61013)).toEqual({
      pid: 61013,
      ppid: 61008,
      runTimeMs: 907_000,
      rssBytes: 51200 * 1024,
      cpuPercent: 0.5,
      status: "S+",
      command: "/usr/bin/deno run --ext=js -A dev.ts",
    });
    expect(rows.get(455)?.command).toBe("node server.mjs --port 3001");
    expect(rows.size).toBe(2);
  });

  it("pairs lsof cwd records with their pid", () => {
    expect(
      parseCwdOutput(
        ["p61013", "fcwd", "n/Users/maxi/GitHub/finance", "p455", "n/tmp/app", ""].join("\n"),
      ),
    ).toEqual(
      new Map([
        [61013, "/Users/maxi/GitHub/finance"],
        [455, "/tmp/app"],
      ]),
    );
  });
});
