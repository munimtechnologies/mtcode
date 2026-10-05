import {
  WS_METHODS,
  type ComputerViewDisplay,
  type ComputerViewFrameEvent,
  type ComputerViewStreamEvent,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

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
  /** The remote pointer, with its shape resolved, when the viewer asked for it. */
  readonly cursor: ComputerViewCursor | null;
  /** Shapes seen in this stream by id; the host sends each image only once. */
  readonly cursorImages: Readonly<Record<string, string>>;
}

export interface ComputerViewCursor {
  readonly id: string;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
  /** Base64 PNG of the shape, or null when it has not arrived. */
  readonly image: string | null;
}

export const EMPTY_COMPUTER_VIEW_STATE: ComputerViewState = {
  displays: [],
  selectedDisplay: null,
  frame: null,
  status: null,
  cursor: null,
  cursorImages: {},
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
        ...EMPTY_COMPUTER_VIEW_STATE,
        displays: event.displays,
        selectedDisplay: event.selectedDisplay,
      };
    case "frame":
      return { ...state, frame: event, status: null };
    case "status":
      return { ...state, status: event.message };
    case "cursor": {
      const cursorImages =
        event.image === undefined || state.cursorImages[event.id] === event.image
          ? state.cursorImages
          : { ...state.cursorImages, [event.id]: event.image };
      return {
        ...state,
        cursorImages,
        cursor: {
          id: event.id,
          visible: event.visible,
          x: event.x,
          y: event.y,
          hotspotX: event.hotspotX,
          hotspotY: event.hotspotY,
          width: event.width,
          height: event.height,
          image: cursorImages[event.id] ?? null,
        },
      };
    }
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
          Stream.scan(() => EMPTY_COMPUTER_VIEW_STATE, applyComputerViewStreamEvent),
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
