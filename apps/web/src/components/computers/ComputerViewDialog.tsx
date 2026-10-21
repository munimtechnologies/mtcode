import {
  COMPUTER_VIEW_MAX_WIDTH_LIMIT,
  type ComputerViewInput,
  type ComputerViewQuality,
  type EnvironmentId,
  type ExecutionEnvironmentPlatformOs,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { mapViewerPointToScreen } from "@t3tools/shared/computerView";
import {
  EyeIcon,
  MaximizeIcon,
  MinimizeIcon,
  MousePointerClickIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";

import { isElectron } from "~/env";
import { resolveShortcutCommand } from "~/keybindings";
import { cn, isMacPlatform } from "~/lib/utils";
import { computerViewEnvironment } from "~/state/computerView";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  base64DecodedLength,
  classifyPointerGesture,
  computerViewFrameDataUrl,
  computerViewKeyPresets,
  mapKeyboardEventToComputerViewInput,
  mapShortcutModifiersForRemote,
  mapWheelToComputerViewInput,
  resolveComputerViewCaptureWidth,
  summarizeComputerViewFrames,
  type ComputerViewFrameSample,
} from "./computerViewInput.logic";
import {
  COMPUTER_VIEW_FRAME_RATES,
  useComputerViewSettings,
  type ComputerViewSettings,
} from "./computerViewSettings";

/** Coalesce wheel spam into one scroll per flush so serial input keeps up. */
const WHEEL_FLUSH_MS = 150;
/**
 * Pointer moves are coalesced to this cadence, and only one is ever in flight:
 * the browser reports motion far faster than a round trip to the remote
 * machine, and only the latest position matters, so a sweep across the
 * picture never builds a queue the remote cursor has to work through.
 */
const POINTER_MOVE_FLUSH_MS = 16;
/** Frames and input round trips older than this drop out of the stats. */
const STATS_WINDOW_MS = 2_000;

const QUALITY_OPTIONS: ReadonlyArray<{ value: ComputerViewQuality; label: string }> = [
  { value: "low", label: "Low (least bandwidth)" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High (sharper text)" },
  { value: "lossless", label: "Lossless" },
];

interface ComputerViewDialogProps {
  environmentId: EnvironmentId;
  environmentLabel: string;
  /** The remote machine's OS, when its server reported one. */
  remoteOs: ExecutionEnvironmentPlatformOs | null;
  keybindings: ResolvedKeybindingsConfig;
  onClose: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

export const ComputerViewDialog = memo(function ComputerViewDialog({
  environmentId,
  environmentLabel,
  remoteOs,
  keybindings,
  onClose,
}: ComputerViewDialogProps) {
  const [settings, updateSettings] = useComputerViewSettings();
  const controlEnabled = settings.remoteControl;
  const localIsMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const [display, setDisplay] = useState<number | undefined>(undefined);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [toolbarRevealed, setToolbarRevealed] = useState(false);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;

  // Streaming is keyed on the capture request, so the width it asks for is
  // derived rather than stored: a frame of the selected display at the size
  // the viewer draws it (scale to fit) or at the screen's own size.
  const [screenWidthHint, setScreenWidthHint] = useState<number | null>(null);
  const captureWidth = useMemo(() => {
    const ratio = settings.highDpi ? devicePixelRatio : 1;
    if (!settings.scaleToFit && screenWidthHint !== null) {
      return Math.min(
        COMPUTER_VIEW_MAX_WIDTH_LIMIT,
        Math.round(screenWidthHint * Math.min(Math.max(ratio, 1), 2)),
      );
    }
    return resolveComputerViewCaptureWidth({
      renderedWidth: containerWidth,
      devicePixelRatio: ratio,
    });
  }, [containerWidth, devicePixelRatio, screenWidthHint, settings.highDpi, settings.scaleToFit]);

  const viewAtom = useMemo(
    () =>
      computerViewEnvironment.view({
        environmentId,
        input: {
          ...(display === undefined ? {} : { display }),
          maxWidth: captureWidth,
          frameRate: settings.frameRate,
          quality: settings.quality,
          cursor: true,
        },
      }),
    [captureWidth, display, environmentId, settings.frameRate, settings.quality],
  );
  const { data: view, error: streamError } = useEnvironmentQuery(viewAtom);
  const sendInputCommand = useAtomCommand(computerViewEnvironment.sendInput, {
    reportFailure: false,
  });
  const frame = view?.frame ?? null;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  // Remembered across stream restarts: changing the capture width restarts the
  // stream, and forgetting the screen size while the next frame is on its way
  // would flip actual-size mode back to a fitted width and restart it again.
  const frameScreenWidth = frame?.screenWidth ?? null;
  if (frameScreenWidth !== null && frameScreenWidth !== screenWidthHint) {
    setScreenWidthHint(frameScreenWidth);
  }

  const surfaceRef = useRef<HTMLImageElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; button: "left" | "right" } | null>(null);
  const wheelRef = useRef<{ deltaX: number; deltaY: number; x: number; y: number } | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveRef = useRef<{ x: number; y: number } | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveInFlightRef = useRef(false);
  const frameSamplesRef = useRef<ComputerViewFrameSample[]>([]);
  const inputLatenciesRef = useRef<Array<{ at: number; ms: number }>>([]);

  const sendInput = useCallback(
    (rawInput: ComputerViewInput): Promise<void> => {
      const input = settings.mapShortcuts
        ? mapShortcutModifiersForRemote(rawInput, { localIsMac, remoteOs })
        : rawInput;
      const startedAt = performance.now();
      return sendInputCommand({ environmentId, input }).then((result) => {
        const finishedAt = performance.now();
        inputLatenciesRef.current = [
          ...inputLatenciesRef.current.filter((entry) => finishedAt - entry.at <= STATS_WINDOW_MS),
          { at: finishedAt, ms: finishedAt - startedAt },
        ];
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
    [environmentId, localIsMac, remoteOs, sendInputCommand, settings.mapShortcuts],
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

  const flushMove = useCallback(() => {
    // Sends the latest position, then whatever arrived while it was in flight.
    const sendLatest = () => {
      if (moveInFlightRef.current) return;
      const pending = moveRef.current;
      if (pending === null) return;
      moveRef.current = null;
      moveInFlightRef.current = true;
      void sendInput({ type: "move", x: pending.x, y: pending.y }).finally(() => {
        moveInFlightRef.current = false;
        sendLatest();
      });
    };
    sendLatest();
  }, [sendInput]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>) => {
      if (!controlEnabled || (event.button !== 0 && event.button !== 2)) return;
      const point = toScreenPoint(event.clientX, event.clientY);
      if (point === null) return;
      // The press lands where the pointer is now; a move still waiting to go
      // out would only arrive after it.
      moveRef.current = null;
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
      void sendInput(
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

  /**
   * The remote pointer follows this one, so hover states, tooltips and menus
   * behave the way they do when sitting at the machine. Skipped while a button
   * is held: that gesture is resolved as a click or drag on release.
   */
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLImageElement>) => {
      if (!controlEnabled || pointerDownRef.current !== null) return;
      const point = toScreenPoint(event.clientX, event.clientY);
      if (point === null) return;
      moveRef.current = point;
      moveTimerRef.current ??= setTimeout(() => {
        moveTimerRef.current = null;
        flushMove();
      }, POINTER_MOVE_FLUSH_MS);
    },
    [controlEnabled, flushMove, toScreenPoint],
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
        if (input !== null) void sendInput(input);
      }, WHEEL_FLUSH_MS);
    },
    [controlEnabled, sendInput, toScreenPoint],
  );

  useEffect(
    () => () => {
      if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current);
      if (moveTimerRef.current !== null) clearTimeout(moveTimerRef.current);
    },
    [],
  );

  // Resize follows the window, debounced and stepped by the width helper, so a
  // drag-resize does not restart the capture stream on every frame.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setContainerWidth(width);
      }, 400);
    });
    observer.observe(container);
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Fullscreen plus Keyboard Lock is what lets Cmd-Tab, Escape, and Cmd-Space
  // reach the remote machine instead of this one. Both are best-effort:
  // Safari has neither, and the viewer stays usable without them.
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (root === null) return;
    if (document.fullscreenElement === null) {
      void root.requestFullscreen?.().then(
        () => {
          const keyboard = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } })
            .keyboard;
          void keyboard?.lock?.().catch(() => undefined);
        },
        () => setInputError("Fullscreen was blocked by this window."),
      );
      return;
    }
    const keyboard = (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard;
    keyboard?.unlock?.();
    void document.exitFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
      setToolbarRevealed(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      const keyboard = (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard;
      keyboard?.unlock?.();
      if (document.fullscreenElement !== null) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, []);

  const sendClipboard = useCallback(() => {
    void navigator.clipboard?.readText?.().then(
      (text) => {
        if (text.length > 0) void sendInput({ type: "type", text: text.slice(0, 4_000) });
      },
      () => setInputError("This window was not allowed to read the clipboard."),
    );
  }, [sendInput]);

  // Pasting types the local clipboard on the remote machine: sending Cmd-V
  // instead would paste whatever is on the REMOTE clipboard, which is not what
  // the person pressing paste in this window means.
  useEffect(() => {
    if (!controlEnabled || !settings.syncClipboard) return;
    const onPaste = (event: globalThis.ClipboardEvent) => {
      if (
        panelRef.current?.contains(event.target as Node | null) ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      void sendInput({ type: "type", text: text.slice(0, 4_000) });
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [controlEnabled, sendInput, settings.syncClipboard]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (resolveShortcutCommand(event, keybindings) === "computerView.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // The options panel is this computer's UI: its fields and buttons keep
      // their keys, and Escape closes it.
      if (panelRef.current?.contains(event.target as Node | null)) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOptionsOpen(false);
        }
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
      if (isEditableTarget(event.target)) return;
      // Mid-composition keystrokes belong to the IME, not the remote machine;
      // the composed text arrives as one printable key when it commits.
      if (event.isComposing || event.keyCode === 229) return;
      // Paste is handled by the clipboard listener above while it is on.
      if (
        settings.syncClipboard &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "v"
      ) {
        return;
      }
      const input = mapKeyboardEventToComputerViewInput(event);
      if (input === null) return;
      event.preventDefault();
      event.stopPropagation();
      void sendInput(input);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [controlEnabled, keybindings, onClose, sendInput, settings.syncClipboard]);

  // Frame bookkeeping for the stats overlay, kept in refs so an idle overlay
  // costs nothing and an open one re-renders once a second, not per frame.
  useEffect(() => {
    if (frame === null) return;
    const now = performance.now();
    frameSamplesRef.current = [
      ...frameSamplesRef.current.filter((sample) => now - sample.at <= STATS_WINDOW_MS),
      { at: now, bytes: base64DecodedLength(frame.data) },
    ];
  }, [frame]);

  const macWindowControlsInset = useMacWindowControlsInset(isFullscreen);
  const [surfaceBox, setSurfaceBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const hasFrame = frame !== null;
  // Where the picture sits in its container, for drawing the remote pointer
  // over it while only watching.
  useEffect(() => {
    const surface = surfaceRef.current;
    const container = containerRef.current;
    if (!hasFrame || surface === null || container === null) return;
    const update = () =>
      setSurfaceBox({
        left: surface.offsetLeft,
        top: surface.offsetTop,
        width: surface.offsetWidth,
        height: surface.offsetHeight,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasFrame]);
  const remoteCursor = view?.cursor ?? null;
  // Like any remote desktop, the pointer over the picture is the remote
  // machine's own: its arrow, I-beam or resize handle, drawn from the shape the
  // host reports, since captures leave the pointer out. Hosts that do not
  // report one (macOS, older helpers) fall back to an ordinary arrow.
  const surfaceCursor =
    !controlEnabled || remoteCursor === null || remoteCursor.image === null
      ? "default"
      : !remoteCursor.visible
        ? "none"
        : `url("data:image/png;base64,${remoteCursor.image}") ${remoteCursor.hotspotX} ${remoteCursor.hotspotY}, default`;
  const watchedCursor =
    !controlEnabled &&
    remoteCursor !== null &&
    remoteCursor.visible &&
    remoteCursor.image !== null &&
    surfaceBox !== null &&
    frame !== null
      ? {
          image: remoteCursor.image,
          left:
            surfaceBox.left +
            ((remoteCursor.x - frame.screenX) / frame.screenWidth) * surfaceBox.width -
            remoteCursor.hotspotX,
          top:
            surfaceBox.top +
            ((remoteCursor.y - frame.screenY) / frame.screenHeight) * surfaceBox.height -
            remoteCursor.hotspotY,
          width: remoteCursor.width,
          height: remoteCursor.height,
        }
      : null;
  const statusMessage = streamError ?? inputError ?? view?.status ?? null;
  const displays = view?.displays ?? [];
  const selectedDisplay = view?.selectedDisplay ?? null;
  const toolbarAutoHides = isFullscreen && !settings.pinToolbar && !optionsOpen;
  const toolbarVisible = !toolbarAutoHides || toolbarRevealed;
  const actualSizeWidth = !settings.scaleToFit && frame !== null ? frame.screenWidth : null;

  const displayButtons =
    displays.length > 1
      ? displays.map((entry) => (
          <button
            key={entry.index}
            type="button"
            onClick={() => setDisplay(entry.index)}
            className={
              entry.index === selectedDisplay
                ? "rounded-sm bg-white/20 px-2 py-0.5 text-xs text-white"
                : "rounded-sm px-2 py-0.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            }
          >
            {entry.label}
          </button>
        ))
      : null;

  // Portalled to the body: rendered inside the chat header, the viewer shared
  // a stacking level with the fixed sidebar toggle, which painted over its
  // title next to the traffic lights.
  return createPortal(
    <div
      data-computer-view
      role="dialog"
      aria-modal="true"
      aria-label={`Live view of ${environmentLabel}`}
      ref={rootRef}
      onPointerMove={
        toolbarAutoHides
          ? (event) => {
              if (event.clientY <= 6) setToolbarRevealed(true);
            }
          : undefined
      }
      className="fixed inset-0 z-50 flex flex-col bg-black [-webkit-app-region:no-drag]"
    >
      {/* The toolbar sits in the window's title bar, so it keeps clear of the
          native controls: the macOS traffic lights on the left, the Windows and
          Linux caption buttons on the right. Its empty space drags the window. */}
      <div
        onPointerLeave={toolbarAutoHides ? () => setToolbarRevealed(false) : undefined}
        style={
          macWindowControlsInset
            ? { paddingLeft: "var(--desktop-window-controls-inset, 90px)" }
            : undefined
        }
        className={cn(
          "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pr-(--workspace-controls-right) pl-(--workspace-controls-left) text-sm text-white/80",
          toolbarAutoHides &&
            "absolute inset-x-0 top-0 z-20 bg-black/90 transition-transform duration-150 motion-reduce:transition-none",
          toolbarAutoHides && !toolbarVisible && "-translate-y-full",
        )}
      >
        <span className="min-w-0 truncate font-medium text-white">{environmentLabel}</span>
        {displayButtons !== null && <div className="flex items-center gap-1">{displayButtons}</div>}
        {statusMessage !== null && (
          <span className="min-w-0 flex-1 truncate text-xs text-warning">{statusMessage}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            label={
              controlEnabled
                ? "Controlling — clicks and keys go to the remote machine"
                : "View only"
            }
            pressed={controlEnabled}
            onClick={() => updateSettings({ remoteControl: !controlEnabled })}
          >
            {controlEnabled ? (
              <MousePointerClickIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            label={
              isFullscreen
                ? "Leave fullscreen"
                : "Fullscreen — sends system shortcuts to the remote machine"
            }
            pressed={isFullscreen}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <MinimizeIcon className="size-4" />
            ) : (
              <MaximizeIcon className="size-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            label="Options"
            pressed={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <Settings2Icon className="size-4" />
          </ToolbarButton>
          <ToolbarButton label="Disconnect" onClick={onClose}>
            <XIcon className="size-4" />
          </ToolbarButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 bg-black",
            settings.scaleToFit ? "items-center justify-center p-3 pt-0" : "overflow-auto",
          )}
        >
          {frame !== null ? (
            <img
              ref={surfaceRef}
              src={computerViewFrameDataUrl(frame)}
              alt={`Screen of ${environmentLabel}`}
              draggable={false}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerMove={handlePointerMove}
              onWheel={handleWheel}
              onContextMenu={(event) => event.preventDefault()}
              style={{
                imageRendering: settings.smoothScaling ? "auto" : "pixelated",
                cursor: surfaceCursor,
                ...(actualSizeWidth === null ? {} : { width: actualSizeWidth }),
              }}
              className={cn(
                "select-none",
                settings.scaleToFit ? "max-h-full max-w-full object-contain" : "m-auto max-w-none",
              )}
            />
          ) : (
            <div className="m-auto flex flex-col items-center gap-3 text-sm text-white/70">
              {streamError === null ? (
                <>
                  <Spinner className="size-5" />
                  <span>Connecting to {environmentLabel}…</span>
                </>
              ) : (
                <span className="max-w-md text-balance text-center">{streamError}</span>
              )}
            </div>
          )}
          {watchedCursor !== null && (
            <img
              aria-hidden
              alt=""
              src={`data:image/png;base64,${watchedCursor.image}`}
              className="pointer-events-none absolute"
              style={{
                left: watchedCursor.left,
                top: watchedCursor.top,
                width: watchedCursor.width,
                height: watchedCursor.height,
              }}
            />
          )}
          {settings.showStats && (
            <ComputerViewStats
              frame={frame}
              captureWidth={captureWidth}
              frameSamplesRef={frameSamplesRef}
              inputLatenciesRef={inputLatenciesRef}
            />
          )}
        </div>
        {optionsOpen && (
          <ComputerViewOptions
            panelRef={panelRef}
            settings={settings}
            updateSettings={updateSettings}
            remoteOs={remoteOs}
            localIsMac={localIsMac}
            displayButtons={displayButtons}
            onSendInput={(input) => void sendInput(input)}
            onSendClipboard={sendClipboard}
            onClose={() => setOptionsOpen(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
});

/**
 * Whether the macOS traffic lights sit over the viewer's toolbar: on the Mac
 * desktop app, except in fullscreen, where macOS hides them.
 */
function useMacWindowControlsInset(isElementFullscreen: boolean): boolean {
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  useEffect(() => {
    const onWindowFullscreenStateChange = window.desktopBridge?.onWindowFullscreenStateChange;
    if (!isMacosDesktop || typeof onWindowFullscreenStateChange !== "function") return;
    return onWindowFullscreenStateChange(setIsWindowFullscreen);
  }, [isMacosDesktop]);
  return isMacosDesktop && !isWindowFullscreen && !isElementFullscreen;
}

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
            onClick={onClick}
            className={
              pressed
                ? "inline-flex size-7 items-center justify-center rounded-sm bg-white/20 text-white"
                : "inline-flex size-7 items-center justify-center rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Session options beside the picture, modelled on a remote desktop client's
 * side panel: how the screen is drawn, what the stream costs, how input is
 * translated, and the clipboard.
 */
function ComputerViewOptions({
  panelRef,
  settings,
  updateSettings,
  remoteOs,
  localIsMac,
  displayButtons,
  onSendInput,
  onSendClipboard,
  onClose,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  settings: ComputerViewSettings;
  updateSettings: (patch: Partial<ComputerViewSettings>) => void;
  remoteOs: ExecutionEnvironmentPlatformOs | null;
  localIsMac: boolean;
  displayButtons: ReactNode;
  onSendInput: (input: ComputerViewInput) => void;
  onSendClipboard: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const presets = computerViewKeyPresets(remoteOs);
  const remoteIsMac = remoteOs === "darwin";
  const shortcutDescription = localIsMac
    ? remoteIsMac
      ? "Both computers are Macs, so shortcuts pass through unchanged."
      : "⌘C, ⌘V, ⌘Z and the rest arrive as Ctrl shortcuts on the remote machine."
    : remoteIsMac
      ? "Ctrl shortcuts arrive as ⌘ shortcuts on the remote Mac."
      : "Both computers use Ctrl, so shortcuts pass through unchanged.";

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Computer View options"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-black text-sm text-white/80"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="font-medium text-white">Options</span>
        <button
          type="button"
          aria-label="Close options"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <OptionSection title="Session">
        <OptionToggle
          label="Scale to fit"
          description="Keep the whole remote screen visible. Off shows it at actual size with scrollbars."
          checked={settings.scaleToFit}
          onChange={(scaleToFit) => updateSettings({ scaleToFit })}
        />
        <OptionToggle
          label="High-DPI mode"
          description="Stream at this display's pixel density for a crisper picture, at the cost of bandwidth."
          checked={settings.highDpi}
          onChange={(highDpi) => updateSettings({ highDpi })}
        />
        <OptionToggle
          label="Smooth scaling"
          description="Turn off to keep pixels sharp when the picture is resized."
          checked={settings.smoothScaling}
          onChange={(smoothScaling) => updateSettings({ smoothScaling })}
        />
      </OptionSection>

      <OptionSection title="Video">
        <OptionSelect
          label="Maximum frame rate"
          description="Higher rates feel more responsive but cost the remote machine more work."
          value={String(settings.frameRate)}
          options={COMPUTER_VIEW_FRAME_RATES.map((rate) => ({
            value: String(rate),
            label: `${rate} FPS`,
          }))}
          onChange={(value) => updateSettings({ frameRate: Number(value) })}
        />
        <OptionSelect
          label="Picture quality"
          description={
            remoteIsMac
              ? "Macs always stream lossless, so this has no effect here."
              : "Higher quality keeps small text readable and uses more bandwidth."
          }
          value={settings.quality}
          options={QUALITY_OPTIONS}
          onChange={(value) =>
            updateSettings({
              quality:
                QUALITY_OPTIONS.find((option) => option.value === value)?.value ?? "standard",
            })
          }
        />
      </OptionSection>

      <OptionSection title="Input controls">
        <OptionToggle
          label="Remote control"
          description="Clicks, keys and scrolling go to the remote machine. Off is view only."
          checked={settings.remoteControl}
          onChange={(remoteControl) => updateSettings({ remoteControl })}
        />
        <OptionToggle
          label="Map shortcuts between Mac and PC"
          description={shortcutDescription}
          checked={settings.mapShortcuts}
          onChange={(mapShortcuts) => updateSettings({ mapShortcuts })}
        />
        <div className="flex flex-col gap-2">
          <span className="text-white">Send keys</span>
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={!settings.remoteControl}
                onClick={() => onSendInput(preset.input)}
                className="flex flex-col items-start rounded-md bg-black px-2 py-1.5 text-left hover:bg-white/10 disabled:opacity-40"
              >
                <span className="font-medium text-white">{preset.label}</span>
                <span className="text-xs text-white/50">{preset.description}</span>
              </button>
            ))}
          </div>
          {remoteOs === "windows" && (
            <span className="text-xs text-white/50">
              Ctrl+Alt+Del can only come from a keyboard attached to that PC.
            </span>
          )}
        </div>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.length === 0) return;
            onSendInput({ type: "type", text });
            setText("");
          }}
        >
          <span className="text-white">On-screen input</span>
          <div className="flex gap-1.5">
            <input
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 4_000))}
              disabled={!settings.remoteControl}
              placeholder="Text to type on the remote machine"
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-black px-2 py-1 text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={!settings.remoteControl || text.length === 0}
              className="rounded-md bg-white/15 px-2.5 py-1 text-white hover:bg-white/25 disabled:opacity-40"
            >
              Type
            </button>
          </div>
        </form>
      </OptionSection>

      <OptionSection title="Displays">
        {displayButtons === null ? (
          <span className="text-xs text-white/50">The remote machine reports one display.</span>
        ) : (
          <div className="flex flex-wrap gap-1">{displayButtons}</div>
        )}
      </OptionSection>

      <OptionSection title="Clipboard">
        <OptionToggle
          label="Synchronize clipboard"
          description="Pasting in this window types what is on this computer's clipboard on the remote machine."
          checked={settings.syncClipboard}
          onChange={(syncClipboard) => updateSettings({ syncClipboard })}
        />
        <button
          type="button"
          disabled={!settings.remoteControl}
          onClick={onSendClipboard}
          className="self-start rounded-md bg-black px-2.5 py-1.5 text-white hover:bg-white/10 disabled:opacity-40"
        >
          Type clipboard now
        </button>
      </OptionSection>

      <OptionSection title="Toolbar">
        <OptionToggle
          label="Pin toolbar in fullscreen"
          description="Off slides it away; move the pointer to the top edge to bring it back."
          checked={settings.pinToolbar}
          onChange={(pinToolbar) => updateSettings({ pinToolbar })}
        />
      </OptionSection>

      <OptionSection title="Support">
        <OptionToggle
          label="Stats for nerds"
          description="Overlay with frame rate, bandwidth and input latency."
          checked={settings.showStats}
          onChange={(showStats) => updateSettings({ showStats })}
        />
      </OptionSection>
    </div>
  );
}

function OptionSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-white/10 px-4 py-3 first-of-type:border-t-0">
      <h3 className="text-xs font-medium tracking-wide text-white/50 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function OptionToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
          checked ? "border-white bg-white text-black" : "border-white/40",
        )}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor">
            <path
              d="M3.5 8.5l3 3 6-7"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-white">{label}</span>
        <span className="text-xs text-white/50">{description}</span>
      </span>
    </button>
  );
}

function OptionSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-white">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-white/15 bg-black px-2 py-1 text-white focus:border-white/40 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-white/50">{description}</span>
    </label>
  );
}

/** Once-a-second readout of the stream; frames themselves never re-render it. */
function ComputerViewStats({
  frame,
  captureWidth,
  frameSamplesRef,
  inputLatenciesRef,
}: {
  frame: {
    width: number;
    height: number;
    screenWidth: number;
    screenHeight: number;
    mimeType: string;
  } | null;
  captureWidth: number;
  frameSamplesRef: React.RefObject<ComputerViewFrameSample[]>;
  inputLatenciesRef: React.RefObject<Array<{ at: number; ms: number }>>;
}) {
  const [{ framesPerSecond, kilobytesPerSecond, latency }, setReadout] = useState<{
    framesPerSecond: number;
    kilobytesPerSecond: number;
    latency: number | null;
  }>({ framesPerSecond: 0, kilobytesPerSecond: 0, latency: null });
  useEffect(() => {
    const sample = () => {
      const now = performance.now();
      const latencies = inputLatenciesRef.current.filter(
        (entry) => now - entry.at <= STATS_WINDOW_MS,
      );
      setReadout({
        ...summarizeComputerViewFrames(frameSamplesRef.current, now, STATS_WINDOW_MS),
        latency:
          latencies.length === 0
            ? null
            : Math.round(
                latencies.reduce((total, entry) => total + entry.ms, 0) / latencies.length,
              ),
      });
    };
    sample();
    const timer = setInterval(sample, 1_000);
    return () => clearInterval(timer);
  }, [frameSamplesRef, inputLatenciesRef]);
  const rows: Array<[string, string]> = [
    ["Frame rate", `${framesPerSecond} fps`],
    ["Bandwidth", `${kilobytesPerSecond} KB/s`],
    ["Input latency", latency === null ? "—" : `${latency} ms`],
    ["Picture", frame === null ? "—" : `${frame.width}×${frame.height}`],
    ["Remote screen", frame === null ? "—" : `${frame.screenWidth}×${frame.screenHeight}`],
    ["Requested width", `${captureWidth}px`],
    ["Encoding", frame === null ? "—" : frame.mimeType === "image/png" ? "PNG" : "JPEG"],
  ];
  return (
    <div className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-black/75 px-3 py-2 font-mono text-2xs leading-5 text-white/85">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-6">
          <span className="text-white/55">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
