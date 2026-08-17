#!/usr/bin/env python3
"""Merge Tier 2 usage PRs into personal-tier2-usage-cursor."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/sheehanmunim/dev/t3code")

PRS = [
    (5828, "fix(usage): handle unavailable environments"),
    (5920, "fix(usage): Improve usage tab for multi environment setups with timeouts and progressive loading"),
    (5806, "fix(usage): usage no longer misses custom provider-instance homes"),
    (7245, "fix(server): treat Cursor API keys as authenticated"),
    (7232, "fix(server): a provider probe timeout no longer marks the provider broken"),
    (7233, "fix(client): a busy backend no longer looks like a disconnect"),
    (7315, "fix(server): settle orphaned provider sessions at startup"),
    (7195, "fix(web): allow new threads when unsettled env is offline"),
    (7216, "fix(server): new threads survive a renamed project folder"),
    (7308, "fix(codex): recover turns after usage limits"),
    (7238, "fix(server): exclude inherited Codex child usage"),
    (7294, "fix(desktop): cap macOS shell startup probe"),
]

CONFLICT_RE = re.compile(
    r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> pr-\d+\n",
    re.DOTALL,
)


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=check,
    )


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run("git", *args, check=check)


def has_conflicts() -> bool:
    result = git("diff", "--name-only", "--diff-filter=U", check=False)
    return bool(result.stdout.strip())


def conflict_files() -> list[str]:
    result = git("diff", "--name-only", "--diff-filter=U", check=False)
    return [line for line in result.stdout.splitlines() if line]


def resolve_usage_key(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        ours, theirs = match.group(1), match.group(2)
        if "clientContractVersion" in ours and "input:" in theirs:
            return (
                "        input: {\n"
                "          sinceDay: input.sinceDay,\n"
                "          untilDay: input.untilDay,\n"
                "          timeZone: input.timeZone,\n"
                "          resolution: input.resolution,\n"
                "          sinceTime: input.sinceTime,\n"
                "          untilTime: input.untilTime,\n"
                "          clientContractVersion: input.clientContractVersion,\n"
                "        },\n"
            )
        return match.group(0)

    return CONFLICT_RE.sub(repl, text)


def resolve_usage_page(text: str) -> str:
    # imports: keep personal + add PR additions
    text = text.replace(
        "<<<<<<< HEAD\nimport type { UsagePricingStatus, UsageProviderKind } from \"@t3tools/contracts\";\nimport { CheckIcon, RefreshCwIcon, XIcon } from \"lucide-react\";\nimport { useCallback, useMemo, useState } from \"react\";\n=======\nimport type { EnvironmentId, UsageProviderKind } from \"@t3tools/contracts\";\nimport { CheckIcon, RefreshCwIcon, XIcon } from \"lucide-react\";\nimport { useEffect, useMemo, useState } from \"react\";\n>>>>>>> pr-5828",
        "import type { EnvironmentId, UsagePricingStatus, UsageProviderKind } from \"@t3tools/contracts\";\nimport { CheckIcon, RefreshCwIcon, XIcon } from \"lucide-react\";\nimport { useCallback, useEffect, useMemo, useState } from \"react\";",
    )
    text = text.replace(
        "import { useUsage, type EnvironmentUsageStatus } from \"../../state/usage\";\nimport {",
        "import { useUsage, type EnvironmentUsageStatus } from \"../../state/usage\";\nimport { isEnvironmentUsageStillReporting } from \"../../state/usageEnvironmentScope\";\nimport {",
    )
    if "isEnvironmentUsageStillReporting" not in text:
        text = text.replace(
            'import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";',
            'import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";\nimport { isEnvironmentUsageStillReporting } from "../../state/usageEnvironmentScope";',
        )

    text = text.replace(
        "<<<<<<< HEAD\nimport { Toggle, ToggleGroup } from \"../ui/toggle-group\";\nimport {\n  WorkspaceBreadcrumb,\n  WorkspaceBreadcrumbItem,\n  WorkspaceBreadcrumbSeparator,\n} from \"../WorkspaceBreadcrumb\";\nimport { WorkspacePageContainer, WorkspacePageHeader } from \"../WorkspacePageContainer\";\nimport { AccountLimitsSection } from \"./AccountLimits\";\nimport { UsageProviderChart, type UsageChartMetric } from \"./UsageProviderChart\";\nimport { PROVIDER_ORDER, PROVIDER_PRESENTATION } from \"./usageProviders\";\n=======\nimport { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from \"../WorkspaceBreadcrumb\";\nimport { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from \"../../workspaceTitlebar\";\nimport { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from \"../ui/select\";\nimport { UsageChartLegend, UsageProviderChart, type UsageChartMetric } from \"./UsageProviderChart\";\nimport { PROVIDER_COLOR, PROVIDER_LABEL, PROVIDER_MARK, PROVIDER_ORDER } from \"./usageProviders\";\n>>>>>>> pr-5828",
        "import { Toggle, ToggleGroup } from \"../ui/toggle-group\";\nimport {\n  WorkspaceBreadcrumb,\n  WorkspaceBreadcrumbItem,\n  WorkspaceBreadcrumbSeparator,\n} from \"../WorkspaceBreadcrumb\";\nimport { WorkspacePageContainer, WorkspacePageHeader } from \"../WorkspacePageContainer\";\nimport { AccountLimitsSection } from \"./AccountLimits\";\nimport { UsageProviderChart, type UsageChartMetric } from \"./UsageProviderChart\";\nimport { PROVIDER_ORDER, PROVIDER_PRESENTATION } from \"./usageProviders\";",
    )

    text = text.replace(
        "<<<<<<< HEAD\n  const { merged, environments, isPending, isPartial, refresh: refreshUsage } = useUsage(window);\n  const { refresh: refreshLimits } = useAccountLimits();\n\n  // Hold the content until every environment is terminal. Rendering merged\n  // totals while devices are still answering makes every number on the page\n  // jump as each one lands.\n  const settling = isPending || isPartial;\n  const costUnavailable = merged.pricingStatus === \"unavailable\";\n  const formatCost = (value: number) => formatUsageCost(merged.pricingStatus, value);\n=======\n  const { merged, options, environments, selectedEnvironmentId, isPending, isPartial, refresh } =\n    useUsage(window, environmentFilter);\n  useEffect(() => {\n    if (environmentFilter !== null && selectedEnvironmentId === null) {\n      setEnvironmentFilter(null);\n    }\n  }, [environmentFilter, selectedEnvironmentId]);\n\n  const usableEnvironmentCount = environments.filter(\n    (environment) =>\n      environment.summary !== null && !merged.staleEnvironments.includes(environment.environmentId),\n  ).length;\n>>>>>>> pr-5828",
        "  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentId | null>(null);\n  const {\n    merged,\n    options,\n    environments,\n    selectedEnvironmentId,\n    isPending,\n    isPartial,\n    refresh: refreshUsage,\n  } = useUsage(window, environmentFilter);\n  const { refresh: refreshLimits } = useAccountLimits();\n\n  useEffect(() => {\n    if (environmentFilter !== null && selectedEnvironmentId === null) {\n      setEnvironmentFilter(null);\n    }\n  }, [environmentFilter, selectedEnvironmentId]);\n\n  const usableEnvironmentCount = environments.filter(\n    (environment) =>\n      environment.summary !== null && !merged.staleEnvironments.includes(environment.environmentId),\n  ).length;\n  const costUnavailable = merged.pricingStatus === \"unavailable\";\n  const formatCost = (value: number) => formatUsageCost(merged.pricingStatus, value);",
    )

    # Remove duplicate environmentFilter if already declared above breakdown state
    text = re.sub(
        r"  const \[breakdown, setBreakdown\] = useState<\"model\" \| \"time\">\\(\"model\"\\);\n  const \[environmentFilter, setEnvironmentFilter\] = useState<EnvironmentId \| null>\(null\);\n",
        '  const [breakdown, setBreakdown] = useState<"model" | "time">("model");\n',
        text,
    )

    # Main content block: keep personal container, PR loading logic
    main_conflict = re.search(
        r"<<<<<<< HEAD\n          <WorkspacePageContainer width=\"wide\">\n            <AccountLimitsSection />\n            \{settling \? \(\n=======.*?>>>>>>> pr-5828\n              <>",
        text,
        re.DOTALL,
    )
    if main_conflict:
        text = text[: main_conflict.start()] + (
            "          <WorkspacePageContainer width=\"wide\">\n"
            "            <AccountLimitsSection />\n"
            "            {options.length > 1 ? (\n"
            "              <div className=\"mb-4 flex justify-end\">\n"
            "                <Select\n"
            "                  value={\n"
            "                    selectedEnvironmentId === null ? \"all\" : `environment:${selectedEnvironmentId}`\n"
            "                  }\n"
            "                  onValueChange={(value) => {\n"
            "                    if (value === null) return;\n"
            "                    setEnvironmentFilter(\n"
            "                      value === \"all\"\n"
            "                        ? null\n"
            "                        : (value.slice(\"environment:\".length) as EnvironmentId),\n"
            "                    );\n"
            "                  }}\n"
            "                  items={[\n"
            "                    { value: \"all\", label: \"All environments\" },\n"
            "                    ...options.map((environment) => ({\n"
            "                      value: `environment:${environment.environmentId}`,\n"
            "                      label: environment.label,\n"
            "                    })),\n"
            "                  ]}\n"
            "                >\n"
            "                  <SelectTrigger size=\"sm\" className=\"w-44\" aria-label=\"Filter environments\">\n"
            "                    <SelectValue />\n"
            "                  </SelectTrigger>\n"
            "                  <SelectPopup align=\"end\" alignItemWithTrigger={false}>\n"
            "                    <SelectItem value=\"all\">All environments</SelectItem>\n"
            "                    {options.map((environment) => (\n"
            "                      <SelectItem\n"
            "                        key={environment.environmentId}\n"
            "                        value={`environment:${environment.environmentId}`}\n"
            "                      >\n"
            "                        {environment.label}\n"
            "                      </SelectItem>\n"
            "                    ))}\n"
            "                  </SelectPopup>\n"
            "                </Select>\n"
            "              </div>\n"
            "            ) : null}\n"
            "            {isPending || (usableEnvironmentCount === 0 && isPartial) ? (\n"
            "              <>"
        ) + text[main_conflict.end() :]

    text = text.replace(
        "<<<<<<< HEAD\n                  pricingStatus={merged.pricingStatus}\n=======\n                  isPartial={isPartial}\n>>>>>>> pr-5828",
        "                  pricingStatus={merged.pricingStatus}\n                  isPartial={isPartial}",
    )

    text = text.replace(
        "<<<<<<< HEAD\n * Says plainly when the totals are incomplete: an environment that failed, a\n * Cursor soft-fail (desktop not signed in / export error), a transcript\n * directory another environment already reported, or a missing rate table.\n * Claude/Codex missing homes are normal when those agents are unused and stay\n * out of this notice.\n=======\n * Explains incomplete totals without hiding healthy environment data.\n>>>>>>> pr-5828",
        " * Says plainly when the totals are incomplete: an environment that failed, a\n * Cursor soft-fail (desktop not signed in / export error), a transcript\n * directory another environment already reported, or a missing rate table.\n * Claude/Codex missing homes are normal when those agents are unused and stay\n * out of this notice.",
    )

    text = text.replace(
        "<<<<<<< HEAD\n  pricingStatus,\n=======\n  isPartial,\n>>>>>>> pr-5828",
        "  pricingStatus,\n  isPartial,",
    )
    text = text.replace(
        "<<<<<<< HEAD\n  readonly pricingStatus: UsagePricingStatus;\n=======\n  readonly isPartial: boolean;\n>>>>>>> pr-5828",
        "  readonly pricingStatus: UsagePricingStatus;\n  readonly isPartial: boolean;",
    )

    notice_guard = re.search(
        r"<<<<<<< HEAD\n  const uncovered = environments\.flatMap\(\(environment\) => \{.*?>>>>>>> pr-5828\n  \) \{\n    return null;\n  \}",
        text,
        re.DOTALL,
    )
    if notice_guard:
        replacement = (
            "  const uncovered = environments.flatMap((environment) => {\n"
            "    if (environment.summary === null) return [];\n"
            "    return environment.summary.sources.filter(isCursorCoverageGap).map((source) => ({\n"
            "      key: `${environment.environmentId}:${source.fingerprint.provider}:${source.status}`,\n"
            "      text: `${environment.label}: ${PROVIDER_PRESENTATION[source.fingerprint.provider].label} ${\n"
            "        source.status === \"missing\" ? \"is uncovered\" : \"could not be loaded\"\n"
            "      }${source.message ? ` (${source.message})` : \"\"}.`,\n"
            "    }));\n"
            "  });\n"
            "  const costUnavailable = pricingStatus === \"unavailable\";\n"
            "  if (\n"
            "    settling.length === 0 &&\n"
            "    unavailable.length === 0 &&\n"
            "    failed.length === 0 &&\n"
            "    stale.length === 0 &&\n"
            "    duplicateSources.length === 0 &&\n"
            "    uncovered.length === 0 &&\n"
            "    !isPartial &&\n"
            "    !costUnavailable\n"
            "  ) {\n"
            "    return null;\n"
            "  }"
        )
        text = text[: notice_guard.start()] + replacement + text[notice_guard.end() :]

    notice_body = re.search(
        r"<<<<<<< HEAD\n      \{costUnavailable \? \(.*?>>>>>>> pr-5828\n      \{failed\.map",
        text,
        re.DOTALL,
    )
    if notice_body:
        replacement = (
            "      {costUnavailable ? (\n"
            "        <span>\n"
            "          The model rate table could not be loaded, so costs are omitted. Token counts are still\n"
            "          valid.\n"
            "        </span>\n"
            "      ) : null}\n"
            "      {isPartial ? <span>Some environments are still reporting. Totals are partial.</span> : null}\n"
            "      {settling.map((environment) => (\n"
            "        <span key={environment.environmentId}>\n"
            "          {environment.label} is {environment.phase}.\n"
            "        </span>\n"
            "      ))}\n"
            "      {unavailable.map((environment) => (\n"
            "        <span key={environment.environmentId}>\n"
            "          {environment.label} is{\" \"}\n"
            "          {environment.phase === \"available\"\n"
            "            ? \"not connected\"\n"
            "            : environment.phase === \"error\"\n"
            "              ? \"unavailable\"\n"
            "              : environment.phase}\n"
            "          .\n"
            "        </span>\n"
            "      ))}\n"
            "      {failed.map"
        )
        text = text[: notice_body.start()] + replacement + text[notice_body.end() :]

    return text


def resolve_mobile_route(text: str) -> str:
    text = text.replace(
        "import { useNavigation } from \"@react-navigation/native\";\n<<<<<<< HEAD\n=======\nimport type { MenuAction } from \"@react-native-menu/menu\";\nimport type { EnvironmentId } from \"@t3tools/contracts\";\nimport type { DailyTotals, MergedUsage } from \"@t3tools/shared/usageMerge\";\n>>>>>>> pr-5828",
        "import { useNavigation } from \"@react-navigation/native\";\nimport type { MenuAction } from \"@react-native-menu/menu\";\nimport type { EnvironmentId } from \"@t3tools/contracts\";",
    )
    text = text.replace(
        "<<<<<<< HEAD\nimport {\n  isCursorCoverageGap,\n  type DailyTotals,\n  type MergedUsage,\n} from \"@t3tools/shared/usageMerge\";\nimport { useMemo, useState } from \"react\";\n=======\nimport { useEffect, useMemo, useState } from \"react\";\n>>>>>>> pr-5828",
        "import {\n  isCursorCoverageGap,\n  type DailyTotals,\n  type MergedUsage,\n} from \"@t3tools/shared/usageMerge\";\nimport { useEffect, useMemo, useState } from \"react\";",
    )
    text = text.replace(
        "<<<<<<< HEAD\n * Says plainly when the totals are incomplete: an environment still answering,\n * one that failed, a Cursor soft-fail, or a transcript directory another\n * environment already reported. Claude/Codex missing homes stay quiet.\n=======\n * Explains incomplete totals without hiding healthy environment data.\n>>>>>>> pr-5828",
        " * Says plainly when the totals are incomplete: an environment still answering,\n * one that failed, a Cursor soft-fail, or a transcript directory another\n * environment already reported. Claude/Codex missing homes stay quiet.",
    )
    return text


def auto_resolve(files: list[str]) -> tuple[list[str], list[str]]:
    resolved: list[str] = []
    unresolved: list[str] = []
    for rel in files:
        path = ROOT / rel
        text = path.read_text()
        original = text
        if rel.endswith("/state/usage.ts"):
            text = resolve_usage_key(text)
        elif rel == "apps/web/src/components/usage/UsagePage.tsx":
            text = resolve_usage_page(text)
        elif rel == "apps/mobile/src/features/usage/UsageRouteScreen.tsx":
            text = resolve_mobile_route(text)
        if "<<<<<<<" in text or ">>>>>>>" in text:
            unresolved.append(rel)
        elif text != original:
            path.write_text(text)
            resolved.append(rel)
        else:
            unresolved.append(rel)
    return resolved, unresolved


def main() -> int:
    merged: list[str] = []
    skipped: list[tuple[str, str]] = []

    branch = git("branch", "--show-current").stdout.strip()
    if branch != "personal-tier2-usage-cursor":
        print(f"Wrong branch: {branch}", file=sys.stderr)
        return 1

    for number, title in PRS:
        ref = f"pr-{number}"
        print(f"\n=== PR #{number}: {title} ===")
        git("fetch", "--no-filter", "origin", f"pull/{number}/head:{ref}", check=False)
        result = git(
            "merge",
            "--no-ff",
            ref,
            "-m",
            f"merge #{number}: {title} (from #{number})",
            check=False,
        )
        if result.returncode == 0:
            print(f"Merged #{number} cleanly")
            merged.append(f"#{number}: {title}")
            continue

        if not has_conflicts():
            print(result.stderr or result.stdout)
            git("merge", "--abort", check=False)
            skipped.append((f"#{number}", f"merge failed: {(result.stderr or result.stdout).strip()}"))
            continue

        files = conflict_files()
        print(f"Conflicts in: {', '.join(files)}")
        resolved, unresolved = auto_resolve(files)
        if unresolved:
            print(f"Could not auto-resolve: {', '.join(unresolved)}")
            git("merge", "--abort", check=False)
            skipped.append((f"#{number}", f"unresolved conflicts: {', '.join(unresolved)}"))
            continue

        for rel in resolved:
            git("add", rel)
        git("add", "-A")
        commit = git(
            "commit",
            "--no-edit",
            check=False,
        )
        if commit.returncode != 0:
            git("merge", "--abort", check=False)
            skipped.append((f"#{number}", "commit after resolution failed"))
            continue
        print(f"Merged #{number} with conflict resolution")
        merged.append(f"#{number}: {title}")

    skipped_path = ROOT / "SKIPPED.md"
    lines = ["# Tier 2 merge SKIPPED\n", f"Branch: personal-tier2-usage-cursor\n\n"]
    if skipped:
        lines.append("## Skipped PRs\n")
        for pr, reason in skipped:
            lines.append(f"- {pr}: {reason}\n")
    else:
        lines.append("No PRs skipped.\n")
    lines.append("\n## Merged PRs\n")
    for entry in merged:
        lines.append(f"- {entry}\n")
    skipped_path.write_text("".join(lines))

    tip = git("rev-parse", "HEAD").stdout.strip()
    print(f"\nTip SHA: {tip}")
    print(f"Merged: {len(merged)}, Skipped: {len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
