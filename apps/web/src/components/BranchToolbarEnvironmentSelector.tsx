import type { TaskPlatform } from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId } from "@t3tools/contracts";
import { ScaleIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  autoBalancePlatformLabel,
  autoBalanceSelectValue,
  parseAutoBalanceSelectValue,
  type RunOnEnvironmentOption,
} from "./BranchToolbar.logic";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const NO_TASK_PLATFORMS: readonly TaskPlatform[] = [];

interface BranchToolbarEnvironmentSelectorProps {
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: ((platform: TaskPlatform | null) => void) | undefined;
  /** Operating systems automatic routing can be limited to; empty hides the choice. */
  autoBalancePlatforms?: readonly TaskPlatform[] | undefined;
  autoBalancePlatform?: TaskPlatform | null | undefined;
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly RunOnEnvironmentOption[];
  // Absent when there is only one environment to show: the indicator still
  // renders (as a static label) so remote projects are always identifiable.
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  autoEnvironmentLabel,
  onAutoEnvironment,
  autoBalancePlatforms = NO_TASK_PLATFORMS,
  autoBalancePlatform = null,
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const selectedAutoValue = autoBalanceSelectValue(autoBalancePlatform);
  const autoItems = useMemo(
    () =>
      onAutoEnvironment
        ? [null, ...autoBalancePlatforms].map((platform) => {
            const value = autoBalanceSelectValue(platform);
            return {
              value,
              platform,
              label:
                autoEnvironmentLabel && value === selectedAutoValue
                  ? autoEnvironmentLabel
                  : platform
                    ? autoBalancePlatformLabel(platform)
                    : "Auto balance",
            };
          })
        : [],
    [autoBalancePlatforms, autoEnvironmentLabel, onAutoEnvironment, selectedAutoValue],
  );
  const environmentItems = useMemo(
    () => [
      ...autoItems,
      ...availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    ],
    [autoItems, availableEnvironments],
  );

  // The static label carries the xs control's height (h-7 sm:h-6) as well as
  // its padding: the composer context strip has no min-height of its own, and
  // the glass seam joining it to the composer assumes a fixed strip height, so
  // a shorter label would drag the seam out of line whenever this label is the
  // only thing in the strip.
  if (envLocked || onEnvironmentChange === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
          data-composer-context-control
        >
          <EnvironmentMachineIcon
            kind={activeEnvironment?.machine ?? "server"}
            className="size-3 shrink-0"
          />
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-drawer group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              {activeEnvironment?.label ?? "Run on"}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>{activeEnvironment?.label ?? "Run on"}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={autoEnvironmentLabel ? selectedAutoValue : environmentId}
      onValueChange={(value) => {
        if (value === null) return;
        const platform = parseAutoBalanceSelectValue(value);
        if (platform === undefined) onEnvironmentChange(value as EnvironmentId);
        else onAutoEnvironment?.(platform);
      }}
      items={environmentItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SelectTrigger
              variant="ghost"
              size="xs"
              className="min-w-0 max-w-full"
              aria-label="Run on"
              data-composer-shortcut="composer.host"
              data-composer-context-control
            />
          }
        >
          {autoEnvironmentLabel ? (
            <ScaleIcon className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <EnvironmentMachineIcon
              kind={activeEnvironment?.machine ?? "server"}
              className="size-3 shrink-0"
            />
          )}
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-drawer group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              <SelectValue />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>{autoEnvironmentLabel ?? activeEnvironment?.label ?? "Run on"}</TooltipPopup>
      </Tooltip>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {autoItems.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              onClick={() => {
                // Re-picking the active automatic choice re-checks the machines.
                if (autoEnvironmentLabel && item.value === selectedAutoValue) {
                  onAutoEnvironment?.(item.platform);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <ScaleIcon className="size-3" aria-hidden="true" />
                {item.label}
              </span>
            </SelectItem>
          ))}
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                <EnvironmentMachineIcon kind={env.machine} className="size-3" />
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
