import type { ComponentType, MouseEventHandler, ReactNode } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

interface TerminalActionButtonProps {
  readonly icon?: ComponentType<{ className?: string }>;
  readonly label: string;
  readonly className?: string;
  readonly onClick: () => void;
  readonly onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
}

export const TerminalActionButton = ({
  icon: Icon,
  label,
  className = "p-1 text-foreground/90 transition-colors hover:bg-accent",
  onClick,
  onMouseDown,
  children,
  disabled,
}: TerminalActionButtonProps) => (
  <Popover>
    <PopoverTrigger
      openOnHover
      render={
        <button
          type="button"
          className={cn(className, disabled && "opacity-45 cursor-not-allowed")}
          onClick={disabled ? undefined : onClick}
          onMouseDown={onMouseDown}
          aria-label={label}
          aria-disabled={disabled}
        />
      }
    >
      {Icon ? <Icon className="size-3.25" /> : children}
    </PopoverTrigger>
    <PopoverPopup
      tooltipStyle
      side="bottom"
      sideOffset={6}
      align="center"
      className="pointer-events-none select-none"
    >
      {label}
    </PopoverPopup>
  </Popover>
);
