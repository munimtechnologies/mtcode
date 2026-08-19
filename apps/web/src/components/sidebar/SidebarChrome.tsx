import {
  ArrowLeftIcon,
  BlocksIcon,
  ChartNoAxesColumnIcon,
  GitPullRequestIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { Link, useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { APP_BASE_NAME } from "../../branding";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageFocusRingOffsetClass,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
  useSidebarStageBackdropVariant,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AccountLimitsHoverCard } from "../usage/AccountLimits";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { useUnreadBackgroundThreadCount } from "../../hooks/useUnreadBackgroundThreadCount";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  // The hook, not the stage-label resolver: this is the header that actually
  // draws the artwork, and reading the build channel here meant a chosen scene
  // never appeared on a release build.
  const backdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  const unreadCount = useUnreadBackgroundThreadCount();

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        unreadCount={unreadCount}
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "focus-visible:ring-white/90 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white! [:hover,[data-pressed]]:bg-white/15",
          backdropVariant && resolveSidebarStageFocusRingOffsetClass(backdropVariant),
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 rounded-full px-1.5 text-muted-foreground"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <BrandWordmark />
      <span
        className={cn(
          "-translate-y-px truncate text-sm font-medium tracking-tight",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {BRAND_LABEL}
      </span>
    </Link>
  );
}

// The mark is the first word of the app name and the label is the rest, so a
// rebranded distro ("MT Code") shows its own wordmark instead of T3's.
const [BRAND_MARK = "T3", ...BRAND_REST] = APP_BASE_NAME.split(" ");
const BRAND_LABEL = BRAND_REST.join(" ");

function BrandWordmark() {
  if (BRAND_MARK === "MT") {
    return <MTWordmark />;
  }
  if (BRAND_MARK !== "T3") {
    return (
      <span aria-label={BRAND_MARK} className="shrink-0 text-sm font-semibold tracking-tight">
        {BRAND_MARK}
      </span>
    );
  }
  return <T3Wordmark />;
}

function MTWordmark() {
  return (
    <svg
      aria-label="MT"
      className="h-3 w-auto shrink-0"
      viewBox="0 0 725 657"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M52.55 87.88L52.71 88.31L51.91 88.23L-0.00 603.93L105.52 614.54L135.85 313.36L180.70 434.81L181.21 439.26L182.29 439.14L184.07 443.91L265.79 413.73L273.57 383.74L293.72 313.04L312.99 481.66L219.10 524.02L180.96 657.00L668.78 436.99L668.19 435.67L631.01 110.43L725.00 105.25L719.20 0.00L419.05 16.55L424.86 121.80L525.04 116.27L554.38 372.82L413.31 436.42L366.62 27.95L262.49 39.87L262.94 43.85L212.90 219.50L150.87 51.56Z"
        fill="currentColor"
      />
    </svg>
  );
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
  tooltipContent,
  tooltipSide = "top",
  tooltipAlign,
  tooltipSideOffset,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tooltipContent?: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  tooltipAlign?: "start" | "center" | "end";
  tooltipSideOffset?: number;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side={tooltipSide} align={tooltipAlign} sideOffset={tooltipSideOffset}>
          {tooltipContent ?? label}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      /^\/settings(?:\/|$)/.test(location.pathname)
        ? "settings"
        : location.pathname === "/status"
          ? "status"
        : location.pathname === "/usage"
          ? "usage"
          : location.pathname === "/pull-requests"
            ? "pull-requests"
            : null,
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/pull-requests", search: { involvement: "all", state: "open" } });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handlePluginsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings/plugins" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, closeMobileSidebar, navigate]);

  return (
    <SidebarMenu className="flex-row items-center">
      {currentFooterPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          <SidebarUtilityItem icon={<BlocksIcon />} label="Plugins" onClick={handlePluginsClick} />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<GitPullRequestIcon />}
              label="Pull Requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
            tooltipContent={<AccountLimitsHoverCard />}
            tooltipSide="right"
            tooltipAlign="end"
            tooltipSideOffset={8}
          />
        </>
      )}
      {/* Footer pages show Back instead of the utility items; the update pill
          belongs with those items, not next to a lone Back. */}
      {currentFooterPage ? null : <SidebarUpdatePill />}
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
