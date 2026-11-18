import type { PluginMarketplaceNotice } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  FilterIcon,
  LayersIcon,
  PackageOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  MARKETPLACE_HARNESSES,
  MARKETPLACE_HARNESS_LABELS,
  canQuickInstallListing,
  groupMarketplaceSections,
  marketplaceContentsSummary,
  marketplaceDisplayName,
  mergeMarketplaceListings,
  splitInstalledListings,
  type MarketplacePlugin,
} from "~/pluginMarketplace/catalog";
import {
  MARKETPLACE_SECTIONS,
  MARKETPLACE_SECTION_LABELS,
  filterMarketplacePlugins,
  isMarketplaceSection,
  marketplaceSectionCounts,
  type MarketplaceCategoryFilter,
  type MarketplaceHarnessFilter,
  type MarketplaceSection,
  type MarketplaceSectionCounts,
  type MarketplaceStatusFilter,
} from "~/pluginMarketplace/filter";
import {
  pluginMarketplaceErrorMessage,
  usePluginMarketplaceStore,
} from "~/pluginMarketplace/store";
import { useSearchableSetting } from "../settingsSearch";
import { SettingsPageContainer, SettingsSection } from "../settingsLayout";
import { HarnessIcon, HarnessSupportBadges, PluginLogo } from "./PluginMarketplacePresentation";
import {
  InstalledSkillsSection,
  usePrimarySkillInventory,
  visibleSkills,
} from "./PluginMarketplaceSkills";

const SECTION_PREVIEW_COUNT = 6;
const RESULTS_PAGE_SIZE = 24;
// While a harness reports "syncing", the server finishes the read in the background; poll so the
// missing plugins appear without a manual refresh.
const SYNCING_REFRESH_MS = 5000;

const EMPTY_SECTION_COUNTS: MarketplaceSectionCounts = {
  plugins: null,
  apps: null,
  mcps: null,
  skills: null,
};

const STATUS_FILTERS: ReadonlyArray<{
  readonly label: string;
  readonly value: MarketplaceStatusFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Installed", value: "installed" },
  { label: "Not installed", value: "available" },
];

const SECTION_DESCRIPTIONS: Readonly<Record<MarketplaceSection, string>> = {
  plugins:
    "Installable bundles of skills, apps, and MCP servers from the Codex, Claude Code, and Cursor marketplaces.",
  apps: "Plugins that connect an outside service, such as a calendar or CRM, through an app connector.",
  mcps: "Plugins that add MCP servers, which give agents tools and data from other services.",
  skills:
    "Reusable instructions an agent loads when a task calls for them: skills installed on this environment, and skills bundled in plugins.",
};

const SECTION_NOUNS: Readonly<Record<MarketplaceSection, string>> = {
  plugins: "plugins",
  apps: "plugins with apps",
  mcps: "plugins with MCP servers",
  skills: "plugins with skills",
};

function isHarnessFilter(value: unknown): value is MarketplaceHarnessFilter {
  return value === "all" || MARKETPLACE_HARNESSES.some((harness) => harness === value);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sectionCountLabel(section: MarketplaceSection, count: number): string {
  switch (section) {
    case "plugins":
      return `${pluralize(count, "plugin")} installed`;
    case "apps":
      return `${pluralize(count, "app")} from installed plugins`;
    case "mcps":
      return `${pluralize(count, "MCP server")} from installed plugins`;
    case "skills":
      return `${pluralize(count, "skill")} installed`;
  }
}

function SectionTabs({
  value,
  counts,
  onChange,
}: {
  readonly value: MarketplaceSection;
  readonly counts: MarketplaceSectionCounts;
  readonly onChange: (value: MarketplaceSection) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Plugin sections"
      variant="pill"
      value={[value]}
      onValueChange={(next) => {
        const selected = next[0];
        if (isMarketplaceSection(selected)) onChange(selected);
      }}
    >
      {MARKETPLACE_SECTIONS.map((section) => {
        const count = counts[section];
        return (
          <Tooltip key={section}>
            <TooltipTrigger
              render={
                <Toggle
                  value={section}
                  aria-label={
                    count === null
                      ? MARKETPLACE_SECTION_LABELS[section]
                      : `${MARKETPLACE_SECTION_LABELS[section]}, ${sectionCountLabel(section, count)}`
                  }
                />
              }
            >
              <span>{MARKETPLACE_SECTION_LABELS[section]}</span>
              {count === null ? null : (
                <span className="tabular-nums text-muted-foreground">{count}</span>
              )}
            </TooltipTrigger>
            {count === null ? null : (
              <TooltipPopup side="bottom">{sectionCountLabel(section, count)}</TooltipPopup>
            )}
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}

function HarnessFilterSelect({
  value,
  onChange,
}: {
  readonly value: MarketplaceHarnessFilter;
  readonly onChange: (value: MarketplaceHarnessFilter) => void;
}) {
  const label = value === "all" ? "All harnesses" : MARKETPLACE_HARNESS_LABELS[value];
  return (
    <Select value={value} onValueChange={(next) => isHarnessFilter(next) && onChange(next)}>
      <SelectTrigger aria-label="Harness">
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2">
            {value === "all" ? (
              <LayersIcon className="size-3.5" />
            ) : (
              <HarnessIcon harness={value} className="size-3.5" />
            )}
            <span className="truncate">{label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          <span className="flex items-center gap-2">
            <LayersIcon className="size-3.5" />
            All harnesses
          </span>
        </SelectItem>
        {MARKETPLACE_HARNESSES.map((harness) => (
          <SelectItem key={harness} value={harness}>
            <span className="flex items-center gap-2">
              <HarnessIcon harness={harness} className="size-3.5" />
              {MARKETPLACE_HARNESS_LABELS[harness]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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

/** Install state on the right of a card: installed check, one-click install, or a detail chevron. */
function PluginCardAction({ plugin }: { readonly plugin: MarketplacePlugin }) {
  const pending = usePluginMarketplaceStore((state) => state.pending[plugin.id] === true);
  const setInstalled = usePluginMarketplaceStore((state) => state.setInstalled);
  const harnessName = MARKETPLACE_HARNESS_LABELS[plugin.sourceHarness];

  if (pending) {
    return <Spinner size="md" aria-label={`Installing ${plugin.name}`} />;
  }
  if (plugin.installed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label="Installed"
              className="flex size-7 items-center justify-center rounded-full bg-success/12 text-success-foreground"
            />
          }
        >
          <CheckIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Installed</TooltipPopup>
      </Tooltip>
    );
  }
  if (!canQuickInstallListing(plugin)) {
    return <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />;
  }
  const install = () => {
    void setInstalled(plugin.id, true)
      .then(() =>
        toastManager.add({
          type: "success",
          title: `${plugin.name} installed on ${harnessName}`,
          description:
            plugin.authPolicy === "ON_INSTALL" || plugin.contents.mcpServerCount > 0
              ? "Open the plugin to connect any accounts it needs, then start a new chat."
              : `Start a new ${harnessName} chat to use it.`,
        }),
      )
      .catch((error: unknown) =>
        toastManager.add({ type: "error", title: pluginMarketplaceErrorMessage(error) }),
      );
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`Install ${plugin.name} on ${harnessName}`}
            onClick={install}
          />
        }
      >
        <PlusIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">Install on {harnessName}</TooltipPopup>
    </Tooltip>
  );
}

function MarketplacePluginCard({
  plugin,
  section,
}: {
  readonly plugin: MarketplacePlugin;
  readonly section: MarketplaceSection;
}) {
  const contents = marketplaceContentsSummary(plugin, section === "plugins" ? null : section);
  return (
    <article className="relative flex min-w-0 items-center gap-3 rounded-xl border border-foreground/8 bg-card/24 p-3 transition-colors has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background hover:bg-foreground/4 dark:bg-card/40">
      <PluginLogo plugin={plugin} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm text-foreground">
          {/* The link's overlay makes the whole card open the detail page; the install button
              sits above it. */}
          <Link
            to="/settings/plugins/$pluginId"
            params={{ pluginId: plugin.id }}
            aria-label={`${plugin.installed ? "Manage" : "View"} ${plugin.name}`}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            {plugin.name}
          </Link>
        </h3>
        <p className="truncate text-muted-foreground text-xs/5 sm:text-sm/5">{plugin.summary}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
          <HarnessSupportBadges support={plugin.support} />
          <span className="truncate">
            {[contents, marketplaceDisplayName(plugin)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center">
        <PluginCardAction plugin={plugin} />
      </div>
    </article>
  );
}

function LoadingMarketplace() {
  return (
    <div className="grid gap-3 lg:grid-cols-2" role="status" aria-label="Loading plugins">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-foreground/8 p-3"
        >
          <Skeleton shape="card" className="size-11 shrink-0 sm:size-10" />
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
  section,
  showAllLabel,
  onShowAll,
}: {
  readonly id: string;
  readonly title: string;
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly section: MarketplaceSection;
  readonly showAllLabel?: string;
  /** Replaces in-place paging with a jump to a filtered view. */
  readonly onShowAll?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(SECTION_PREVIEW_COUNT);
  const visible = plugins.slice(0, visibleCount);
  const hidden = plugins.length - visible.length;
  const headingId = `marketplace-section-${id}`;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-semibold text-lg text-foreground">
          {title}
        </h2>
        <p className="tabular-nums text-base text-muted-foreground sm:text-sm">
          {pluralize(plugins.length, "plugin")}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((plugin) => (
          <MarketplacePluginCard key={plugin.id} plugin={plugin} section={section} />
        ))}
      </div>
      {hidden > 0 ? (
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={onShowAll ?? (() => setVisibleCount((count) => count + RESULTS_PAGE_SIZE))}
        >
          {onShowAll
            ? (showAllLabel ?? `Show all ${plugins.length}`)
            : `Show ${Math.min(RESULTS_PAGE_SIZE, hidden)} more`}
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
    <>
      {sections.installed.length > 0 ? (
        <PluginSection
          id="installed"
          title="Installed"
          section="plugins"
          plugins={sections.installed}
          showAllLabel={`Show all ${sections.installed.length} installed`}
          onShowAll={onShowInstalled}
        />
      ) : null}
      {sections.discover.length > 0 ? (
        <PluginSection
          id="featured"
          title="Featured"
          section="plugins"
          plugins={sections.discover}
        />
      ) : null}
      {sections.categories.map((category) => (
        <PluginSection
          key={category.category}
          id={`category-${sectionId(category.category)}`}
          title={category.category}
          section="plugins"
          plugins={category.plugins}
          showAllLabel={`Show all ${category.plugins.length} in ${category.category}`}
          onShowAll={() => onSelectCategory(category.category)}
        />
      ))}
    </>
  );
}

/** Apps, MCPs, and the plugin half of Skills: what is installed, then what could be. */
function InstalledAndAvailable({
  plugins,
  section,
  installedTitle,
  availableTitle,
}: {
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly section: MarketplaceSection;
  readonly installedTitle: string;
  readonly availableTitle: string;
}) {
  const { installed, available } = useMemo(() => splitInstalledListings(plugins), [plugins]);
  return (
    <>
      {installed.length > 0 ? (
        <PluginSection
          id={`${section}-installed`}
          title={installedTitle}
          section={section}
          plugins={installed}
        />
      ) : null}
      {available.length > 0 ? (
        <PluginSection
          id={`${section}-available`}
          title={availableTitle}
          section={section}
          plugins={available}
        />
      ) : null}
    </>
  );
}

function NoResults({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <Empty size="compact">
      <EmptyMedia variant="icon">
        <PackageOpenIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

function FilteredResults({
  plugins,
  section,
}: {
  readonly plugins: ReadonlyArray<MarketplacePlugin>;
  readonly section: MarketplaceSection;
}) {
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const visible = plugins.slice(0, visibleCount);
  return (
    <section className="space-y-2" aria-labelledby="marketplace-results-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="marketplace-results-title" className="font-semibold text-lg text-foreground">
          {section === "skills" ? "Plugins with skills" : "Results"}
        </h2>
        <p className="tabular-nums text-base text-muted-foreground sm:text-sm">
          {pluralize(plugins.length, "plugin")}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((plugin) => (
          <MarketplacePluginCard key={plugin.id} plugin={plugin} section={section} />
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

export function PluginMarketplace({
  section,
  harness,
  onSectionChange,
  onHarnessChange,
}: {
  readonly section: MarketplaceSection;
  readonly harness: MarketplaceHarnessFilter;
  readonly onSectionChange: (section: MarketplaceSection) => void;
  readonly onHarnessChange: (harness: MarketplaceHarnessFilter) => void;
}) {
  const searchableSetting = useSearchableSetting();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MarketplaceStatusFilter>("all");
  const [category, setCategory] = useState<MarketplaceCategoryFilter>("all");
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);
  const plugins = usePluginMarketplaceStore((state) => state.plugins);
  const searchHits = usePluginMarketplaceStore((state) => state.searchHits);
  const notices = usePluginMarketplaceStore((state) => state.notices);
  const catalogStatus = usePluginMarketplaceStore((state) => state.catalogStatus);
  const error = usePluginMarketplaceStore((state) => state.catalogError);
  const loadCatalog = usePluginMarketplaceStore((state) => state.loadCatalog);
  const searchCatalog = usePluginMarketplaceStore((state) => state.searchCatalog);
  const skillInventory = usePrimarySkillInventory(skillsRefreshKey);
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
  const allSkills = useMemo(
    () => visibleSkills(skillInventory, "", harness),
    [harness, skillInventory],
  );
  const matchingSkills = useMemo(
    () => visibleSkills(skillInventory, query, harness),
    [harness, query, skillInventory],
  );
  // Counts stay blank until the catalog has loaded; a "0" while loading would be a lie.
  const counts = useMemo(
    () =>
      catalogStatus === "ready"
        ? marketplaceSectionCounts(catalogPlugins, harness, allSkills?.length ?? null)
        : EMPTY_SECTION_COUNTS,
    [allSkills, catalogPlugins, catalogStatus, harness],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(
          filterMarketplacePlugins(catalogPlugins, {
            query: "",
            section,
            status: "all",
            harness,
            category: "all",
          }).map((plugin) => plugin.category),
        ),
      ].toSorted(),
    [catalogPlugins, harness, section],
  );
  const filteredPlugins = useMemo(
    () => filterMarketplacePlugins(catalogPlugins, { query, section, status, harness, category }),
    [catalogPlugins, category, harness, query, section, status],
  );
  // The harness filter narrows the browse layout; search, status, and category switch to a flat
  // result list.
  const isFiltered = query.trim().length > 0 || status !== "all" || category !== "all";
  const activeFilterCount = Number(status !== "all") + Number(category !== "all");
  const resetFilters = () => {
    setStatus("all");
    setCategory("all");
  };
  const clearAll = () => {
    setQuery("");
    onHarnessChange("all");
    resetFilters();
  };
  const changeSection = (next: MarketplaceSection) => {
    // Categories differ per section, so a category picked on one tab would silently empty another.
    setCategory("all");
    onSectionChange(next);
  };
  const clearFiltersButton = (
    <Button size="sm" variant="outline" onClick={clearAll}>
      Clear filters
    </Button>
  );

  const renderCatalog = () => {
    if (section === "skills") {
      return (
        <>
          {status === "available" ? null : (
            <InstalledSkillsSection
              key={`${query}|${harness}`}
              state={skillInventory}
              skills={matchingSkills}
              onRetry={() => setSkillsRefreshKey((value) => value + 1)}
            />
          )}
          {isFiltered ? (
            filteredPlugins.length > 0 ? (
              <FilteredResults
                key={`${query}|${status}|${harness}|${category}`}
                plugins={filteredPlugins}
                section={section}
              />
            ) : null
          ) : (
            <InstalledAndAvailable
              key={harness}
              plugins={filteredPlugins}
              section={section}
              installedTitle="Bundled in installed plugins"
              availableTitle="Available in plugins"
            />
          )}
        </>
      );
    }
    if (filteredPlugins.length === 0) {
      return isFiltered || harness !== "all" ? (
        <NoResults
          title={`No ${SECTION_NOUNS[section]} found`}
          description="Try a different search, harness, or filter."
          action={clearFiltersButton}
        />
      ) : (
        <NoResults
          title={`No ${SECTION_NOUNS[section]} yet`}
          description={
            section === "apps"
              ? "No marketplace lists an app connector yet. Remote Codex plugins show their apps once installed."
              : "No marketplace lists a plugin with MCP servers."
          }
        />
      );
    }
    if (isFiltered) {
      return (
        <FilteredResults
          key={`${query}|${status}|${harness}|${category}|${section}`}
          plugins={filteredPlugins}
          section={section}
        />
      );
    }
    if (section === "plugins") {
      return (
        <BrowseSections
          key={harness}
          plugins={filteredPlugins}
          onShowInstalled={() => setStatus("installed")}
          onSelectCategory={setCategory}
        />
      );
    }
    return (
      <InstalledAndAvailable
        key={`${section}|${harness}`}
        plugins={filteredPlugins}
        section={section}
        installedTitle="Installed"
        availableTitle="Available"
      />
    );
  };

  return (
    <SettingsPageContainer className="max-w-5xl gap-8">
      <header className="space-y-5 px-1 sm:px-0">
        <div className="space-y-1">
          <h1 className="text-balance font-semibold text-3xl tracking-tight text-foreground">
            Plugins
          </h1>
          <p className="max-w-[68ch] text-pretty text-base/7 text-muted-foreground sm:text-sm/6">
            Browse and manage Codex, Claude Code, and Cursor plugins, and the apps, MCP servers, and
            skills they bring.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs value={section} counts={counts} onChange={changeSection} />
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
            <InputGroup className="min-w-0 flex-1">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                name="plugin-search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={`Search ${MARKETPLACE_SECTION_LABELS[section].toLocaleLowerCase()}`}
                aria-label={`Search ${MARKETPLACE_SECTION_LABELS[section].toLocaleLowerCase()}`}
              />
            </InputGroup>
            <div className="w-40 shrink-0">
              <HarnessFilterSelect value={harness} onChange={onHarnessChange} />
            </div>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    size="icon"
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
                padding="none"
              >
                <div className="flex flex-col gap-3 p-3">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <PopoverTitle>Filters</PopoverTitle>
                    {activeFilterCount > 0 ? (
                      <Button size="xs" variant="ghost-muted" onClick={resetFilters}>
                        Reset
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <p className="font-medium text-base text-foreground sm:text-sm">Status</p>
                    <Select
                      value={status}
                      onValueChange={(value) =>
                        value && setStatus(value as MarketplaceStatusFilter)
                      }
                    >
                      <SelectTrigger size="sm" aria-label="Filter by install status">
                        <SelectValue>
                          {STATUS_FILTERS.find((option) => option.value === status)?.label ?? "All"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_FILTERS.map((option) => (
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
                        <SelectValue>
                          {category === "all" ? "All categories" : category}
                        </SelectValue>
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
        </div>
        <p className="max-w-[80ch] text-pretty text-muted-foreground text-sm">
          {SECTION_DESCRIPTIONS[section]}
        </p>
      </header>

      <SettingsSection
        {...searchableSetting("plugin-marketplace")}
        variant="plain"
        className="space-y-0"
        contentClassName="flex flex-col gap-10"
        hideHeader
      >
        {catalogStatus === "idle" || catalogStatus === "loading" ? <LoadingMarketplace /> : null}
        {catalogStatus === "error" ? (
          <NoResults
            title="Plugin marketplaces are unavailable"
            description={error ?? "The plugin marketplaces could not be loaded."}
            action={
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCwIcon />
                Try again
              </Button>
            }
          />
        ) : null}
        {catalogStatus === "ready" ? (
          <>
            {error || notices.length > 0 ? (
              <div className="flex flex-col gap-2">
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
              </div>
            ) : null}
            {catalogPlugins.length === 0 && section !== "skills" ? (
              <NoResults
                title={
                  notices.some((notice) => notice.status === "syncing")
                    ? "Loading plugin marketplaces"
                    : "No plugins available"
                }
                description={
                  notices.some((notice) => notice.status === "syncing")
                    ? "Plugins will appear as each harness finishes syncing."
                    : "No configured harness returned any plugins."
                }
                action={
                  <Button size="sm" variant="outline" onClick={refresh}>
                    <RefreshCwIcon />
                    Refresh
                  </Button>
                }
              />
            ) : (
              renderCatalog()
            )}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
