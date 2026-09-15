import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SearchOptionButton } from "~/components/search/SearchOptionButton";

const STATUS_CLASS = "inline-block min-w-12 tabular-nums text-xs text-muted-foreground";

export interface TerminalSearchBarProps {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regex: boolean;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly truncated: boolean;
  readonly error: string | null;
  readonly focusRequestId: number;
  readonly isFindShortcut: (event: KeyboardEvent) => boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onCaseSensitiveChange: (caseSensitive: boolean) => void;
  readonly onRegexChange: (regex: boolean) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

export function TerminalSearchBar(props: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocusRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastFocusRequestIdRef.current === props.focusRequestId) return;
    lastFocusRequestIdRef.current = props.focusRequestId;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [props.focusRequestId]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") (event.shiftKey ? props.onPrevious : props.onNext)();
    else if (event.key === "Escape") props.onClose();
    else if (props.isFindShortcut(event.nativeEvent)) inputRef.current?.select();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const actions = [
    [ChevronUp, "Previous match", props.onPrevious, props.matchCount === 0],
    [ChevronDown, "Next match", props.onNext, props.matchCount === 0],
    [X, "Close find", props.onClose, false],
  ] as const;

  return (
    <div className="absolute top-8 right-4 z-20 flex items-center gap-2 rounded-md border bg-popover px-2 py-1.5 shadow-xs">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Find"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Find in terminal"
        aria-invalid={props.error !== null}
        size="compact"
        className="w-44"
        nativeInput
      />

      <div onMouseDown={(e) => e.preventDefault()} className="flex items-center gap-0.5">
        <SearchOptionButton
          active={props.regex}
          label="Use regular expression"
          onClick={() => props.onRegexChange(!props.regex)}
        >
          .*
        </SearchOptionButton>
        <SearchOptionButton
          active={props.caseSensitive}
          label="Match case"
          onClick={() => props.onCaseSensitiveChange(!props.caseSensitive)}
        >
          Aa
        </SearchOptionButton>
      </div>

      <span className={props.error ? "text-destructive" : STATUS_CLASS}>
        {props.error
          ? "Invalid"
          : props.query.length > 0 &&
            (props.matchCount === 0
              ? "No results"
              : `${props.activeIndex + 1}/${props.matchCount}${props.truncated ? "+" : ""}`)}
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
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}
