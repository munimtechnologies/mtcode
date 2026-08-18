"use client";

import type {
  ComputerViewInput,
  EnvironmentId,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { mapViewerPointToScreen } from "@t3tools/shared/computerView";
import { EyeIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { resolveShortcutCommand } from "~/keybindings";
import { computerViewEnvironment } from "~/state/computerView";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  classifyPointerGesture,
  computerViewFrameDataUrl,
  mapKeyboardEventToComputerViewInput,
  mapWheelToComputerViewInput,
} from "./computerViewInput.logic";

/** Coalesce wheel spam into one scroll per flush so serial input keeps up. */
const WHEEL_FLUSH_MS = 150;

interface ComputerViewDialogProps {
  environmentId: EnvironmentId;
  environmentLabel: string;
  keybindings: ResolvedKeybindingsConfig;
  onClose: () => void;
}

export const ComputerViewDialog = memo(function ComputerViewDialog({
  environmentId,
  environmentLabel,
  keybindings,
  onClose,
}: ComputerViewDialogProps) {
  const [display, setDisplay] = useState<number | undefined>(undefined);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [inputError, setInputError] = useState<string | null>(null);
  const viewAtom = useMemo(
    () =>
      computerViewEnvironment.view({
        environmentId,
        input: display === undefined ? {} : { display },
      }),
    [display, environmentId],
  );
  const { data: view, error: streamError } = useEnvironmentQuery(viewAtom);
  const sendInputCommand = useAtomCommand(computerViewEnvironment.sendInput, {
    reportFailure: false,
  });
  const frame = view?.frame ?? null;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const surfaceRef = useRef<HTMLImageElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; button: "left" | "right" } | null>(null);
  const wheelRef = useRef<{ deltaX: number; deltaY: number; x: number; y: number } | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendInput = useCallback(
    (input: ComputerViewInput) => {
      void sendInputCommand({ environmentId, input }).then((result) => {
        if (result._tag === "Failure") {
          const failure = result.cause.reasons.find((reason) => reason._tag === "Fail");
          const error = failure?._tag === "Fail" ? failure.error : null;
          setInputError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The remote machine rejected the input.",
          );
          return;
        }
        setInputError(null);
      });
    },
    [environmentId, sendInputCommand],
  );

  /** Client coordinates to remote screen coordinates, or null outside the frame. */
  const toScreenPoint = useCallback((clientX: number, clientY: number) => {
    const currentFrame = frameRef.current;
    const surface = surfaceRef.current;
    if (currentFrame === null || surface === null) return null;
    const rect = surface.getBoundingClientRect();
    return mapViewerPointToScreen({
      clientX,
      clientY,
      elementLeft: rect.left,
      elementTop: rect.top,
      elementWidth: rect.width,
      elementHeight: rect.height,
      imageWidth: currentFrame.width,
      imageHeight: currentFrame.height,
      screenX: currentFrame.screenX,
      screenY: currentFrame.screenY,
      screenWidth: currentFrame.screenWidth,
      screenHeight: currentFrame.screenHeight,
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>) => {
      if (!controlEnabled || (event.button !== 0 && event.button !== 2)) return;
      const point = toScreenPoint(event.clientX, event.clientY);
      if (point === null) return;
      pointerDownRef.current = {
        ...point,
        button: event.button === 2 ? "right" : "left",
      };
    },
    [controlEnabled, toScreenPoint],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>) => {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!controlEnabled || down === null) return;
      const point = toScreenPoint(event.clientX, event.clientY);
      if (point === null) return;
      sendInput(
        classifyPointerGesture({
          from: { x: down.x, y: down.y },
          to: point,
          button: down.button,
          clickCount: Math.max(1, event.detail),
        }),
      );
    },
    [controlEnabled, sendInput, toScreenPoint],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLImageElement>) => {
      if (!controlEnabled) return;
      const point = toScreenPoint(event.clientX, event.clientY);
      if (point === null) return;
      const pending = wheelRef.current;
      wheelRef.current = {
        deltaX: (pending?.deltaX ?? 0) + event.deltaX,
        deltaY: (pending?.deltaY ?? 0) + event.deltaY,
        ...point,
      };
      wheelTimerRef.current ??= setTimeout(() => {
        wheelTimerRef.current = null;
        const accumulated = wheelRef.current;
        wheelRef.current = null;
        if (accumulated === null) return;
        const input = mapWheelToComputerViewInput(accumulated);
        if (input !== null) sendInput(input);
      }, WHEEL_FLUSH_MS);
    },
    [controlEnabled, sendInput, toScreenPoint],
  );

  useEffect(
    () => () => {
      if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (resolveShortcutCommand(event, keybindings) === "computerView.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (!controlEnabled) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        return;
      }
      const input = mapKeyboardEventToComputerViewInput(event);
      if (input === null) return;
      event.preventDefault();
      event.stopPropagation();
      sendInput(input);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [controlEnabled, keybindings, onClose, sendInput]);

  const statusMessage = streamError ?? inputError ?? view?.status ?? null;
  const displays = view?.displays ?? [];

  return (
    <div
      data-computer-view
      role="dialog"
      aria-modal="true"
      aria-label={`Live view of ${environmentLabel}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 [-webkit-app-region:no-drag]"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3 text-sm text-white/80">
        <span className="min-w-0 truncate font-medium text-white">{environmentLabel}</span>
        {displays.length > 1 && (
          <div className="flex items-center gap-1">
            {displays.map((entry) => (
              <button
                key={entry.index}
                type="button"
                onClick={() => setDisplay(entry.index)}
                className={
                  entry.index === (view?.selectedDisplay ?? null)
                    ? "rounded-sm bg-white/20 px-2 py-0.5 text-xs text-white"
                    : "rounded-sm px-2 py-0.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                }
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
        {statusMessage !== null && (
          <span className="min-w-0 flex-1 truncate text-xs text-amber-300">{statusMessage}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={controlEnabled}
                  aria-label={controlEnabled ? "Switch to view only" : "Enable remote control"}
                  onClick={() => setControlEnabled((enabled) => !enabled)}
                  className={
                    controlEnabled
                      ? "inline-flex size-7 items-center justify-center rounded-sm bg-white/20 text-white"
                      : "inline-flex size-7 items-center justify-center rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
                  }
                />
              }
            >
              {controlEnabled ? (
                <MousePointerClickIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {controlEnabled
                ? "Controlling — clicks and keys go to the remote machine"
                : "View only"}
            </TooltipPopup>
          </Tooltip>
          <button
            type="button"
            aria-label="Close computer view"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 pt-0">
        {frame !== null ? (
          <img
            ref={surfaceRef}
            src={computerViewFrameDataUrl(frame)}
            alt={`Screen of ${environmentLabel}`}
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            onContextMenu={(event) => event.preventDefault()}
            className={`h-full w-full select-none object-contain ${controlEnabled ? "cursor-crosshair" : ""}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-sm text-white/70">
            {streamError === null ? (
              <>
                <Spinner className="size-5 text-white/70" />
                <span>Connecting to {environmentLabel}…</span>
              </>
            ) : (
              <span className="max-w-md text-balance text-center">{streamError}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
