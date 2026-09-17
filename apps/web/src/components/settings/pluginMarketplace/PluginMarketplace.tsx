import type { PluginMarketplaceNotice } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  FilterIcon,
  LayersIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import {
  MARKETPLACE_HARNESSES,
  MARKETPLACE_HARNESS_LABELS,
  groupMarketplaceSections,
  marketplaceDisplayName,
  mergeMarketplaceListings,
  type MarketplaceHarnessId,
  type MarketplacePlugin,
} from "~/pluginMarketplace/catalog";
import {
  filterMarketplacePlugins,
  type MarketplaceCategoryFilter,
  type MarketplaceHarnessFilter,
  type MarketplaceKindFilter,
} from "~/pluginMarketplace/filter";
import { usePluginMarketplaceStore } from "~/pluginMarketplace/store";
import { searchableSetting } from "../settingsSearch";
import { SettingsPageContainer, SettingsSection } from "../settingsLayout";
import { HarnessIcon, HarnessSupportBadges, PluginLogo } from "./PluginMarketplacePresentation";

const SECTION_PREVIEW_COUNT = 6;
const RESULTS_PAGE_SIZE = 24;
// While a harness reports "syncing", the server finishes the read in the background; poll so the
// missing plugins appear without a manual refresh.
const SYNCING_REFRESH_MS = 5000;

const KIND_FILTERS: ReadonlyArray<{
  readonly label: string;
  readonly value: MarketplaceKindFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Installed", value: "installed" },
  { label: "MCP", value: "mcp" },
  { label: "Skills", value: "skill" },
  { label: "Apps", value: "app" },
];

function isHarnessFilter(value: unknown): value is MarketplaceHarnessFilter {
  return value === "all" || MARKETPLACE_HARNESSES.some((harness) => harness === value);
}

function HarnessTabs({
  value,
  counts,
  onChange,
}: {
  readonly value: MarketplaceHarnessFilter;
  readonly counts: Readonly<Record<MarketplaceHarnessFilter, number>>;
  readonly onChange: (value: MarketplaceHarnessFilter) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Harness"
      value={[value]}
      className="max-w-full overflow-x-auto"
      onValueChange={(next) => {
        const selected = next[0];
        if (isHarnessFilter(selected)) onChange(selected);
      }}
    >
      {(["all", ...MARKETPLACE_HARNESSES] as const).map((harness) => (
        <Toggle key={harness} value={harness} aria-label={harnessTabLabel(harness)}>
          {harness === "all" ? (
            <LayersIcon className="size-3.5" />
          ) : (
            <HarnessIcon harness={harness} className="size-3.5" />
          )}
          <span>{harnessTabLabel(harness)}</span>
          <span className="tabular-nums text-muted-foreground">{counts[harness]}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function harnessTabLabel(harness: MarketplaceHarnessFilter): string {
  return harness === "all" ? "All" : MARKETPLACE_HARNESS_LABELS[harness];
}

function CatalogNotices({
  notices,
  onRetry,
}: {
  readonly notices: ReadonlyArray<PluginMarketplaceNotice>;
  readonly onRetry: () => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <Alert
          key={notice.harness}
          variant={notice.status === "syncing" ? "info" : "warning"}
          role={notice.status === "syncing" ? "status" : "alert"}
          aria-label={`${MARKETPLACE_HARNESS_LABELS[notice.harness]} plugins ${notice.status}`}
        >
          {notice.status === "syncing" ? (
            <Spinner className="size-4" aria-label="Syncing" />
          ) : (
            <TriangleAlertIcon className="size-4" />
          )}
          <AlertDescription>{notice.message}</AlertDescription>
          {notice.status === "syncing" ? null : (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={onRetry}>
                <RefreshCwIcon />
                Retry
              </Button>
            </AlertAction>
          )}
        </Alert>
      ))}
    </div>
  );
}

function MarketplacePluginCard({
  plugin,
  featured = false,
}: {
  readonly plugin: MarketplacePlugin;
  readonly featured?: boolean;
}) {
  return (
    <article className="min-w-0">
      <Link
        to="/settings/plugins/$pluginId"
        params={{ pluginId: plugin.id }}
        aria-label={`${plugin.installed ? "Manage" : "View"} ${plugin.name}`}
        className={cn(
          "group flex min-w-0 items-center gap-3 rounded-xl border border-foreground/8 bg-card/24 p-3 outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-card/40",
          featured && "sm:p-4",
        )}
      >
        <PluginLogo plugin={plugin} size="small" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-medium text-base text-foreground sm:text-sm">
              {plugin.name}
            </h3>
            {plugin.installed ? (
              <span className="flex shrink-0 items-center gap-1 text-success-foreground text-xs">
                <CheckIcon className="size-3.5" />
                Installed
              </span>
            ) : null}
          </div>
          <p className="truncate text-base/7 text-muted-foreground sm:text-sm/5">
            {plugin.summary}
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <HarnessSupportBadges support={plugin.support} />
            <span className="truncate text-muted-foreground text-xs">
              {marketplaceDisplayName(plugin)}
            </span>
          </div>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </article>
  );
}

function LoadingMarketplace() {
  return (
    <div className="grid gap-3 lg:grid-cols-2" role="status" aria-label="Loading plugins">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="flex items-start gap-3 rounded-xl border border-foreground/8 p-4"
        >
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PluginSection({
  id,
  title,
  plugins,
  featured = false,
  showAllLabel,
  onShowAll,
}: {
  readonly id: string;
  readonly title: string;
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly featured?: boolean;
  readonly showAllLabel?: string;
  readonly onShowAll?: () => void;
}) {
  const visible = plugins.slice(0, SECTION_PREVIEW_COUNT);
  const hidden = plugins.length - visible.length;
  const headingId = `marketplace-section-${id}`;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-semibold text-lg text-foreground">
          {title}
        </h2>
        <p className="tabular-nums text-base text-muted-foreground sm:text-sm">
          {plugins.length} {plugins.length === 1 ? "plugin" : "plugins"}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((plugin) => (
          <MarketplacePluginCard key={plugin.id} plugin={plugin} featured={featured} />
        ))}
      </div>
      {hidden > 0 && onShowAll ? (
        <Button size="sm" variant="ghost-muted" onClick={onShowAll}>
          {showAllLabel ?? `Show ${hidden} more`}
        </Button>
      ) : null}
    </section>
  );
}

function sectionId(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-");
}

function BrowseSections({
  plugins,
  onShowInstalled,
  onSelectCategory,
}: {
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly onShowInstalled: () => void;
  readonly onSelectCategory: (category: string) => void;
}) {
  const sections = useMemo(() => groupMarketplaceSections(plugins), [plugins]);
  return (
    <div className="flex flex-col gap-10">
      {sections.installed.length > 0 ? (
        <PluginSection
          id="installed"
          title="Installed"
          plugins={sections.installed}
          showAllLabel={`Show all ${sections.installed.length} installed`}
          onShowAll={onShowInstalled}
        />
      ) : null}
      {sections.discover.length > 0 ? (
        <PluginSection id="discover" title="Discover" plugins={sections.discover} featured />
      ) : null}
      {sections.categories.map((section) => (
        <PluginSection
          key={section.category}
          id={`category-${sectionId(section.category)}`}
          title={section.category}
          plugins={section.plugins}
          onShowAll={() => onSelectCategory(section.category)}
        />
      ))}
    </div>
  );
}

function FilteredResults({
  plugins,
  onReset,
}: {
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly onReset: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  if (plugins.length === 0) {
    return (
      <Empty className="min-h-64 border border-dashed border-foreground/10">
        <EmptyMedia variant="icon">
          <PackageOpenIcon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No plugins found</EmptyTitle>
          <EmptyDescription>Try a different search, harness, or category.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onReset}>
            Clear filters
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const visible = plugins.slice(0, visibleCount);
  return (
    <section className="space-y-2" aria-labelledby="marketplace-results-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="marketplace-results-title" className="font-semibold text-lg text-foreground">
          Results
        </h2>
        <p className="tabular-nums text-base text-muted-foreground sm:text-sm">
          {plugins.length} {plugins.length === 1 ? "plugin" : "plugins"}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((plugin) => (
          <MarketplacePluginCard key={plugin.id} plugin={plugin} />
        ))}
      </div>
      {visible.length < plugins.length ? (
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={() => setVisibleCount((count) => count + RESULTS_PAGE_SIZE)}
        >
          Show {Math.min(RESULTS_PAGE_SIZE, plugins.length - visible.length)} more
        </Button>
      ) : null}
    </section>
  );
}

export function PluginMarketplace() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MarketplaceKindFilter>("all");
  const [harness, setHarness] = useState<MarketplaceHarnessFilter>("all");
  const [category, setCategory] = useState<MarketplaceCategoryFilter>("all");
  const plugins = usePluginMarketplaceStore((state) => state.plugins);
  const searchHits = usePluginMarketplaceStore((state) => state.searchHits);
  const notices = usePluginMarketplaceStore((state) => state.notices);
  const status = usePluginMarketplaceStore((state) => state.catalogStatus);
  const error = usePluginMarketplaceStore((state) => state.catalogError);
  const loadCatalog = usePluginMarketplaceStore((state) => state.loadCatalog);
  const searchCatalog = usePluginMarketplaceStore((state) => state.searchCatalog);
  const refresh = () => void loadCatalog(true).catch(() => undefined);

  useEffect(() => {
    void loadCatalog(true).catch(() => undefined);
  }, [loadCatalog]);

  useEffect(() => {
    if (!notices.some((notice) => notice.status === "syncing")) return;
    const timeout = window.setTimeout(() => {
      void loadCatalog(true).catch(() => undefined);
    }, SYNCING_REFRESH_MS);
    return () => window.clearTimeout(timeout);
  }, [loadCatalog, notices]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void searchCatalog(query).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, searchCatalog]);

  const catalogPlugins = useMemo(() => {
    if (searchHits.length === 0) return mergeMarketplaceListings(plugins);
    const knownIds = new Set(plugins.map((plugin) => plugin.id));
    return mergeMarketplaceListings([
      ...plugins,
      ...searchHits.filter((plugin) => !knownIds.has(plugin.id)),
    ]);
  }, [plugins, searchHits]);
  const harnessCounts = useMemo(() => {
    const counts: Record<MarketplaceHarnessFilter, number> = {
      all: catalogPlugins.length,
      codex: 0,
      claude: 0,
      cursor: 0,
    };
    for (const plugin of catalogPlugins) {
      const seen = new Set<MarketplaceHarnessId>();
      for (const entry of plugin.support) {
        if (seen.has(entry.harness)) continue;
        seen.add(entry.harness);
        counts[entry.harness] += 1;
      }
    }
    return counts;
  }, [catalogPlugins]);
  const categories = useMemo(
    () => [...new Set(catalogPlugins.map((plugin) => plugin.category))].toSorted(),
    [catalogPlugins],
  );
  const filteredPlugins = useMemo(
    () => filterMarketplacePlugins(catalogPlugins, { query, kind, harness, category }),
    [catalogPlugins, category, harness, kind, query],
  );
  // The harness tabs narrow the browse layout; search, type, and category switch to a flat list.
  const isFiltered = query.trim().length > 0 || kind !== "all" || category !== "all";
  const activeFilterCount = Number(kind !== "all") + Number(category !== "all");
  const resetFilters = () => {
    setKind("all");
    setCategory("all");
  };
  const clearAll = () => {
    setQuery("");
    setHarness("all");
    resetFilters();
  };

  return (
    <SettingsPageContainer className="max-w-5xl gap-10">
      <header className="space-y-5 px-1 sm:px-0">
        <div className="space-y-1">
          <h1 className="text-balance font-semibold text-3xl tracking-tight text-foreground">
            Plugins
          </h1>
          <p className="max-w-[68ch] text-pretty text-base/7 text-muted-foreground sm:text-sm/6">
            Discover real Codex, Claude Code, and Cursor plugins, including their MCP servers and
            skills, in one place.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              name="plugin-search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search plugins"
              aria-label="Search plugins"
              size="lg"
            />
          </InputGroup>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon-lg"
                  variant={activeFilterCount > 0 ? "secondary" : "outline"}
                  aria-label={
                    activeFilterCount > 0
                      ? `Filters, ${activeFilterCount} active`
                      : "Filter plugins"
                  }
                />
              }
            >
              <FilterIcon />
            </PopoverTrigger>
            <PopoverPopup
              align="end"
              side="bottom"
              sideOffset={8}
              className="w-72 max-w-[calc(100vw-2rem)]"
              viewportClassName="p-3"
            >
              <div className="flex flex-col gap-3">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <PopoverTitle className="text-base sm:text-sm">Filters</PopoverTitle>
                  {activeFilterCount > 0 ? (
                    <Button size="xs" variant="ghost-muted" onClick={resetFilters}>
                      Reset
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="font-medium text-base text-foreground sm:text-sm">Type</p>
                  <Select
                    value={kind}
                    onValueChange={(value) => value && setKind(value as MarketplaceKindFilter)}
                  >
                    <SelectTrigger size="sm" aria-label="Filter by plugin type">
                      <SelectValue>
                        {KIND_FILTERS.find((option) => option.value === kind)?.label ?? "All"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_FILTERS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="font-medium text-base text-foreground sm:text-sm">Category</p>
                  <Select value={category} onValueChange={(value) => value && setCategory(value)}>
                    <SelectTrigger size="sm" aria-label="Filter by category">
                      <SelectValue>{category === "all" ? "All categories" : category}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((categoryValue) => (
                        <SelectItem key={categoryValue} value={categoryValue}>
                          {categoryValue}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverPopup>
          </Popover>
        </div>
        <HarnessTabs value={harness} counts={harnessCounts} onChange={setHarness} />
      </header>

      <SettingsSection
        {...searchableSetting("plugin-marketplace")}
        variant="plain"
        className="space-y-0"
        contentClassName="space-y-6"
        hideHeader
      >
        {status === "idle" || status === "loading" ? <LoadingMarketplace /> : null}
        {status === "error" ? (
          <Empty className="min-h-64 border border-dashed border-foreground/10">
            <EmptyMedia variant="icon">
              <PackageOpenIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Plugin marketplaces are unavailable</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCwIcon />
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {status === "ready" ? (
          <>
            {error ? (
              <Alert variant="warning">
                <TriangleAlertIcon className="size-4" />
                <AlertDescription>
                  Showing cached plugin data because the latest refresh failed: {error}
                </AlertDescription>
                <AlertAction>
                  <Button size="xs" variant="outline" onClick={refresh}>
                    <RefreshCwIcon />
                    Retry
                  </Button>
                </AlertAction>
              </Alert>
            ) : null}
            <CatalogNotices notices={notices} onRetry={refresh} />
            {catalogPlugins.length === 0 ? (
              <Empty className="min-h-64 border border-dashed border-foreground/10">
                <EmptyMedia variant="icon">
                  <PackageOpenIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    {notices.some((notice) => notice.status === "syncing")
                      ? "Loading plugin marketplaces"
                      : "No plugins available"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {notices.some((notice) => notice.status === "syncing")
                      ? "Plugins will appear as each harness finishes syncing."
                      : "No configured harness returned any plugins."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={refresh}>
                    <RefreshCwIcon />
                    Refresh
                  </Button>
                </EmptyContent>
              </Empty>
            ) : isFiltered ? (
              <FilteredResults
                key={`${query}|${kind}|${harness}|${category}`}
                plugins={filteredPlugins}
                onReset={clearAll}
              />
            ) : (
              <BrowseSections
                plugins={filteredPlugins}
                onShowInstalled={() => setKind("installed")}
                onSelectCategory={setCategory}
              />
            )}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
