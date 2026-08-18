import {
  WS_METHODS,
  type ComputerViewDisplay,
  type ComputerViewFrameEvent,
  type ComputerViewStreamEvent,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";

/** Latest accumulated view of a computerView.stream subscription. */
export interface ComputerViewState {
  readonly displays: ReadonlyArray<ComputerViewDisplay>;
  readonly selectedDisplay: number | null;
  readonly frame: ComputerViewFrameEvent | null;
  /** Most recent status message; cleared once frames flow again. */
  readonly status: string | null;
}

export const EMPTY_COMPUTER_VIEW_STATE: ComputerViewState = {
  displays: [],
  selectedDisplay: null,
  frame: null,
  status: null,
};

export function applyComputerViewStreamEvent(
  state: ComputerViewState,
  event: ComputerViewStreamEvent,
): ComputerViewState {
  switch (event.type) {
    case "ready":
      // A resubscribe (reconnect, display switch) re-announces displays; the
      // stale frame is dropped so the viewer never maps clicks against it.
      return {
        displays: event.displays,
        selectedDisplay: event.selectedDisplay,
        frame: null,
        status: null,
      };
    case "frame":
      return { ...state, frame: event, status: null };
    case "status":
      return { ...state, status: event.message };
  }
}

export function createComputerViewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    view: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:computer-view:stream",
      // Streams are heavy (a capture every frame); drop the subscription the
      // moment the viewer closes instead of keeping it warm.
      idleTtlMs: 0,
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.computerViewStream>) =>
        subscribe(WS_METHODS.computerViewStream, input).pipe(
          Stream.scan(EMPTY_COMPUTER_VIEW_STATE, applyComputerViewStreamEvent),
        ),
    }),
    sendInput: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:computer-view:input",
      tag: WS_METHODS.computerViewInput,
      scheduler,
      // Serial per environment: clicks, keys, and typed text must reach the
      // remote machine in the order the user produced them.
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
  };
}
