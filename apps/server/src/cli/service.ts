import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Terminal from "effect/Terminal";
import { Command, Flag, GlobalFlag, Prompt } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import { compareExactServiceVersions } from "../cloud/serviceProtocol.ts";
import type * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { resolveAppDisplayName } from "../appDisplayName.ts";

export const bootServiceLayer = (config: ServerConfig.ServerConfig["Service"]) => {
  const input = {
    baseDir: config.baseDir,
    logsDir: config.logsDir,
    cliVersion: packageJson.version,
  };
  // Windows has no systemd, so it gets its own backend. Loading it lazily keeps
  // the Linux path free of any Windows import.
  return Layer.unwrap(
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      if (platform !== "win32") return BootService.layer(input);
      const windows = yield* Effect.promise(() => import("../cloud/bootServiceWindows.ts"));
      return windows.layer(input);
    }),
  ).pipe(Layer.provide(ProcessRunner.layer));
};

export type ServiceReconcileResult =
  | {
      readonly changed: false;
      readonly status: BootService.BootServiceStatus;
    }
  | {
      readonly changed: true;
      readonly previouslyInstalled: boolean;
      readonly plan: BootService.BootServicePlan;
    };

/** Install, update, or repair the service using the CLI version running this command. */
export const reconcileService = Effect.fn("cli.service.reconcile")(function* (options?: {
  readonly allowDowngrade?: boolean;
}) {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  if (status.installed && status.current) {
    return { changed: false, status } satisfies ServiceReconcileResult;
  }
  if (
    status.installedVersion !== undefined &&
    options?.allowDowngrade !== true &&
    compareExactServiceVersions(packageJson.version, status.installedVersion) < 0
  ) {
    return yield* new BootService.BootServiceDowngradeRefusedError({
      installedVersion: status.installedVersion,
      targetVersion: packageJson.version,
    });
  }
  const plan = yield* service.install(options);
  return {
    changed: true,
    previouslyInstalled: status.installed,
    plan,
  } satisfies ServiceReconcileResult;
});

export function formatServiceStatus(
  status: BootService.BootServiceStatus,
  cliVersion: string,
): string {
  if (!status.supported) {
    return `${resolveAppDisplayName()} service\n  Status: unavailable on this machine\n  Supported on: Linux with systemd, macOS with launchd, or Windows`;
  }
  if (!status.installed) {
    return `${resolveAppDisplayName()} service\n  Status: not installed\n  Next: Run \`t3 service install\`.`;
  }
  const locationLabel =
    status.kind === "systemd" ? "Unit" : status.kind === "launchd" ? "LaunchAgent" : "Shortcut";
  const installedVersion = status.installedVersion ?? cliVersion;
  const problems = (status.problems ?? []).map(
    (problem) => `  [${problem}] ${BootService.formatBootServiceProblem(problem)}`,
  );
  if (
    !status.current &&
    status.installedVersion !== undefined &&
    compareExactServiceVersions(status.installedVersion, cliVersion) > 0
  ) {
    return [
      `${resolveAppDisplayName()} service`,
      `  Status: installed · t3@${installedVersion} (newer than this t3@${cliVersion} CLI)`,
      `  ${locationLabel}: ${status.unitPath}`,
      `  Logs: ${status.logPath}`,
      ...problems,
      `  Next: Use \`npx t3@${installedVersion} service update\` to repair it, or pass \`--allow-downgrade\` explicitly.`,
    ].join("\n");
  }
  return [
    `${resolveAppDisplayName()} service`,
    `  Status: ${status.current ? `installed · t3@${installedVersion}` : "needs an update or repair"}`,
    `  ${locationLabel}: ${status.unitPath}`,
    `  Logs: ${status.logPath}`,
    ...problems,
    ...(status.current ? [] : [`  Next: Run \`npx t3@${cliVersion} service update\`.`]),
  ].join("\n");
}

const runServiceCommand = Effect.fn("cli.service.run")(function* <A, E>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: Effect.Effect<A, E, BootService.BootService>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* run.pipe(Effect.provide(bootServiceLayer(config)));
});

/** Windows only. The blink at sign-in looks alarming until you know what it is. */
const WINDOWS_SERVICE_NOTICE = [
  `A small window named \`${resolveAppDisplayName()} Server\` blinks once when you sign in. That is expected.`,
  "It appears under Startup apps in Windows Settings, where you can switch it off.",
  "It starts at sign-in, not at boot, and it stops when you sign out.",
].join("\n");

/** Shared by install and update. The Linux output is unchanged. */
const reportReconcileResult = Effect.fn("cli.service.report")(function* (
  result: ServiceReconcileResult,
  unchangedMessage: string,
) {
  if (!result.changed) {
    yield* Console.log(unchangedMessage);
    return;
  }
  yield* Console.log(
    `${result.previouslyInstalled ? "Updated" : "Installed"} ${resolveAppDisplayName()} service with t3@${packageJson.version}.\nLogs: ${result.plan.logPath}`,
  );
  if ((yield* HostProcessPlatform) === "win32") {
    yield* Console.log(WINDOWS_SERVICE_NOTICE);
  }
});

const serviceReconcileFlags = {
  ...projectLocationFlags,
  allowDowngrade: Flag.boolean("allow-downgrade").pipe(
    Flag.withDescription("Allow replacing a newer installed service with this older CLI version."),
    Flag.withDefault(false),
  ),
};

const serviceInstallCommand = Command.make("install", serviceReconcileFlags).pipe(
  Command.withDescription(
    `Install ${resolveAppDisplayName()} as a background service for this user.`,
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService({ allowDowngrade: flags.allowDowngrade });
        yield* reportReconcileResult(
          result,
          `${resolveAppDisplayName()} service is already installed with t3@${packageJson.version}.`,
        );
      }),
    ),
  ),
);

const serviceUpdateCommand = Command.make("update", serviceReconcileFlags).pipe(
  Command.withDescription(
    "Update or repair the background service using this CLI version. Use `npx t3@latest service update` for the latest release.",
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService({ allowDowngrade: flags.allowDowngrade });
        yield* reportReconcileResult(
          result,
          `${resolveAppDisplayName()} service is already using t3@${packageJson.version}.`,
        );
      }),
    ),
  ),
);

const serviceUninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription(`Stop and remove the ${resolveAppDisplayName()} background service.`),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const removed = yield* service.uninstall;
        yield* Console.log(
          removed
            ? `Removed the ${resolveAppDisplayName()} service.`
            : `${resolveAppDisplayName()} service is not installed.`,
        );
      }),
    ),
  ),
);

const serviceStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription(
    `Show whether the ${resolveAppDisplayName()} background service is installed.`,
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        yield* Console.log(formatServiceStatus(yield* service.status, packageJson.version));
      }),
    ),
  ),
);

export const offerServiceDuringOnboarding = Effect.gen(function* () {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  const { supported, installed, current } = status;
  if (!supported) {
    return false;
  }
  if (installed && current) {
    yield* Console.log(
      `${resolveAppDisplayName()} is already set up to run in the background on this machine.`,
    );
    return true;
  }
  for (const problem of status.problems ?? []) {
    yield* Console.warn(`[${problem}] ${BootService.formatBootServiceProblem(problem)}`);
  }
  if (
    installed &&
    status.installedVersion !== undefined &&
    compareExactServiceVersions(status.installedVersion, packageJson.version) > 0
  ) {
    yield* Console.log(
      `A newer t3@${status.installedVersion} background service is installed. Leaving it unchanged.`,
    );
    // This CLI cannot verify the newer service. Keep the manual fallback available.
    return false;
  }
  // A LaunchAgent (macOS) and a Startup shortcut (Windows) both start at
  // login and die at logout; neither has an enable-linger equivalent the way
  // systemd does. Do not promise more than that.
  const platform = yield* HostProcessPlatform;
  const wanted = yield* Prompt.run(
    Prompt.confirm({
      message: installed
        ? `The installed ${resolveAppDisplayName()} service needs an update or repair. Update it now?`
        : platform === "darwin"
          ? `Run ${resolveAppDisplayName()} in the background whenever you log in to this Mac? ` +
            "It stays reachable through T3 Connect while you are logged in."
          : platform === "win32"
            ? `Run ${resolveAppDisplayName()} in the background whenever you sign in to Windows? ` +
              "It starts again after every reboot, and stops when you sign out."
            : `Run ${resolveAppDisplayName()} in the background whenever this machine boots? ` +
              "It stays reachable through T3 Connect even after you log out.",
      initial: true,
    }),
  );
  if (!wanted) {
    return false;
  }
  const result = yield* reconcileService();
  if (result.changed) {
    yield* Console.log(
      `Background service ${result.previouslyInstalled ? "updated" : "installed"}. Logs: ${result.plan.logPath}`,
    );
    if (platform === "win32") yield* Console.log(WINDOWS_SERVICE_NOTICE);
  }
  return true;
});

export const recoverServiceOnboardingOffer = <R>(
  offer: Effect.Effect<boolean, BootService.BootServiceError | Terminal.QuitError, R>,
) =>
  offer.pipe(
    Effect.catchTags({
      QuitError: () => Effect.succeed(false),
      BootServiceUnsupportedError: (error) =>
        Console.log(`Skipping background setup: ${error.message}`).pipe(Effect.as(false)),
      BootServiceCommandError: (error) =>
        Console.warn(`Background setup did not finish: ${error.message}`).pipe(Effect.as(false)),
      BootServiceInstallError: (error) =>
        Console.warn(`Background setup did not finish: ${error.message}`).pipe(Effect.as(false)),
      BootServicePrerequisiteError: (error) =>
        Console.warn(`Background setup did not finish: ${error.message}`).pipe(Effect.as(false)),
      BootServiceUpdatePendingError: (error) =>
        Console.warn(`Background setup did not finish: ${error.message}`).pipe(Effect.as(false)),
      // Both carry guidance the user has to act on, so print the message itself
      // rather than the generic "did not finish" wrapper.
      BootServicePathHasPercentError: (error) =>
        Console.warn(`Skipping background setup: ${error.message}`).pipe(Effect.as(false)),
      BootServiceStartupEntryDisabledError: (error) =>
        Console.warn(`Skipping background setup: ${error.message}`).pipe(Effect.as(false)),
      BootServiceDowngradeRefusedError: (error) =>
        Console.warn(`Background setup did not finish: ${error.message}`).pipe(Effect.as(false)),
    }),
  );

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription(`Manage the ${resolveAppDisplayName()} background service.`),
  Command.withSubcommands([
    serviceInstallCommand,
    serviceUninstallCommand,
    serviceUpdateCommand,
    serviceStatusCommand,
  ]),
);
