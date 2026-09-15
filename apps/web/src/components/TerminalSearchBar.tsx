import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SearchOptionButton } from "~/components/search/SearchOptionButton";
import { cn } from "~/lib/utils";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const TERMINAL_FIND_POSITION_STORAGE_KEY = "t3code:terminal-find-position:v1";
const TerminalFindPosition = Schema.Literals(["top", "bottom"]);
const DRAG_THRESHOLD_PX = 4;
const PANE_EDGE_GAP_PX = 4;

interface GripDrag {
  readonly pointerId: number;
  readonly startY: number;
  readonly minOffset: number;
  readonly maxOffset: number;
  readonly startCenter: number;
  readonly paneCenter: number;
}

export interface TerminalSearchBarProps {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly truncated: boolean;
  readonly focusRequestId: number;
  readonly isFindShortcut: (event: KeyboardEvent) => boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onCaseSensitiveChange: (caseSensitive: boolean) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function TerminalSearchBar(props: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GripDrag | null>(null);
  const snapFromTopRef = useRef<number | null>(null);
  const lastFocusRequestIdRef = useRef<number | null>(null);
  const [position, setPosition] = useLocalStorage(
    TERMINAL_FIND_POSITION_STORAGE_KEY,
    "top",
    TerminalFindPosition,
  );
  const lastPositionRef = useRef(position);

  useEffect(() => {
    if (lastFocusRequestIdRef.current === props.focusRequestId) return;
    lastFocusRequestIdRef.current = props.focusRequestId;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [props.focusRequestId]);

  useLayoutEffect(() => {
    if (lastPositionRef.current === position) return;
    lastPositionRef.current = position;
    const bar = barRef.current;
    const fromTop = snapFromTopRef.current;
    snapFromTopRef.current = null;
    if (!bar || fromTop === null) return;
    bar.dataset.dragging = "";
    bar.style.transform = "";
    const restingTop = bar.getBoundingClientRect().top;
    bar.style.transform = `translateY(${fromTop - restingTop}px)`;
    bar.getBoundingClientRect();
    delete bar.dataset.dragging;
    bar.style.transform = "";
  }, [position]);

  const settle = (next: "top" | "bottom") => {
    const bar = barRef.current;
    if (!bar) return;
    if (next === position) {
      delete bar.dataset.dragging;
      bar.style.transform = "";
      return;
    }
    snapFromTopRef.current = bar.getBoundingClientRect().top;
    setPosition(next);
  };

  const handleContainerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nativeEvent = event.nativeEvent;
    if (nativeEvent.key === "Escape") {
      props.onClose();
      event.preventDefault();
      event.stopPropagation();
    } else if (props.isFindShortcut(nativeEvent)) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
      event.preventDefault();
      event.stopPropagation();
    } else if (nativeEvent.key === "Enter" && event.target === inputRef.current) {
      (nativeEvent.shiftKey ? props.onPrevious : props.onNext)();
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bar = barRef.current;
    const pane = bar?.offsetParent as HTMLElement | null;
    if (!bar || !pane) return;
    const barRect = bar.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      minOffset: paneRect.top + PANE_EDGE_GAP_PX - barRect.top,
      maxOffset: paneRect.bottom - PANE_EDGE_GAP_PX - barRect.bottom,
      startCenter: barRect.top + barRect.height / 2,
      paneCenter: paneRect.top + paneRect.height / 2,
    };
    bar.dataset.dragging = "";
  };

  const handleGripPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bar = barRef.current;
    if (!bar) return;
    const offset = clamp(event.clientY - drag.startY, drag.minOffset, drag.maxOffset);
    bar.style.transform = `translateY(${offset}px)`;
  };

  const handleGripPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    const bar = barRef.current;
    if (!bar) return;
    const moved = event.clientY - drag.startY;
    if (event.type !== "pointercancel" && Math.abs(moved) < DRAG_THRESHOLD_PX) {
      settle(position === "top" ? "bottom" : "top");
    } else {
      settle(
        drag.startCenter + clamp(moved, drag.minOffset, drag.maxOffset) > drag.paneCenter
          ? "bottom"
          : "top",
      );
    }
  };

  const handleGripClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) settle(position === "top" ? "bottom" : "top");
  };

  const positionClass = position === "top" ? "top-8" : "bottom-2";
  const actions = [
    [ChevronUp, "Previous match", props.onPrevious, props.matchCount === 0],
    [ChevronDown, "Next match", props.onNext, props.matchCount === 0],
    [X, "Close find", props.onClose, false],
  ] as const;

  return (
    <div
      ref={barRef}
      onKeyDown={handleContainerKeyDown}
      className={cn(
        "pointer-events-auto absolute z-20 flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 shadow-lg/20 backdrop-blur-xl",
        positionClass,
        "right-4",
        "origin-right transition-[opacity,scale,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-dragging:transition-none starting:scale-95 starting:opacity-0 motion-reduce:transition-none",
      )}
    >
      <button
        type="button"
        onPointerDown={handleGripPointerDown}
        onPointerMove={handleGripPointerMove}
        onPointerUp={handleGripPointerEnd}
        onPointerCancel={handleGripPointerEnd}
        onClick={handleGripClick}
        aria-label={position === "top" ? "Move find bar to bottom" : "Move find bar to top"}
        className="w-4 cursor-grab text-muted-foreground active:cursor-grabbing touch-none"
      >
        <GripVertical className="size-3.5" />
      </button>

      <Input
        ref={inputRef}
        type="text"
        placeholder="Find"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        aria-label="Find in terminal"
        className="h-6 w-28 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
        nativeInput
        unstyled
      />

      <div onMouseDown={(e) => e.preventDefault()}>
        <SearchOptionButton
          active={props.caseSensitive}
          label="Match case"
          onClick={() => props.onCaseSensitiveChange(!props.caseSensitive)}
        >
          Aa
        </SearchOptionButton>
      </div>

      <span className="min-w-9 text-center text-[11px] tabular-nums text-muted-foreground">
        {props.query.length === 0
          ? ""
          : props.matchCount === 0
            ? "0/0"
            : `${props.activeIndex + 1}/${props.matchCount}${props.truncated ? "+" : ""}`}
      </span>

      {actions.map(([Icon, label, onClick, disabled]) => (
        <Button
          key={label}
          variant="ghost"
          size="icon-micro"
          aria-label={label}
          onClick={onClick}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </div>
  );
}
