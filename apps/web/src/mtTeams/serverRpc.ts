/**
 * The ONLY module that touches the MT Teams fork RPCs
 * (docs/internals/mt-teams.md "Fork RPCs"): `mtTeamsConfigure` sends the
 * registered service URL + environment key to one environment's server, and
 * `mtTeamsStatus` reads that server's bridge status. Everything the UI
 * consumes is exposed behind explicitly typed hooks, so contract changes land
 * here and nowhere else in `apps/web/src/mtTeams`.
 */
import { useCallback } from "react";
import {
  WS_METHODS,
  type EnvironmentId,
  type MtTeamsBridgeStatus,
  type MtTeamsConfigureInput,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";

export type { MtTeamsBridgeStatus, MtTeamsConfigureInput };

const mtTeamsConfigureCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:mt-teams:configure",
  tag: WS_METHODS.mtTeamsConfigure,
});

const mtTeamsStatusAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:mt-teams:status",
  tag: WS_METHODS.mtTeamsStatus,
});

function rpcErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "The MT Teams request failed on this environment.";
}

/** Send `mtTeamsConfigure` to one environment's server over the existing ws RPC path. */
export function useMtTeamsConfigure(): (
  environmentId: EnvironmentId,
  input: MtTeamsConfigureInput,
) => Promise<{ readonly ok: boolean; readonly error: string | null }> {
  const run = useAtomCommand(mtTeamsConfigureCommand, { reportFailure: false });
  return useCallback(
    async (environmentId, input) => {
      const result = await run({ environmentId, input });
      if (result._tag === "Success") return { ok: result.value.ok, error: null };
      return { ok: false, error: rpcErrorMessage(squashAtomCommandFailure(result)) };
    },
    [run],
  );
}

/** `mtTeamsStatus` read for one environment; `refresh` after configuring. */
export function useMtTeamsBridgeStatus(environmentId: EnvironmentId | null): {
  readonly status: MtTeamsBridgeStatus | null;
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    environmentId === null ? null : mtTeamsStatusAtom({ environmentId, input: {} }),
  );
  return {
    status: query.data ?? null,
    refresh: query.refresh,
  };
}
