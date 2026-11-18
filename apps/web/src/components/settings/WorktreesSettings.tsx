import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import { useGT } from "gt-react";

import { DraftInput } from "../ui/draft-input";
import { AdvancedSettings } from "./AdvancedSettings";
import { BranchNamingSettings } from "./BranchNamingSettings";
import { WorktreeSubmodulesRow } from "./ProjectDefaultsSettings";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { WorktreeCleanupSection, WorktreesDirectoryRow } from "./StorageSettings";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function StartFromRemoteRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      {...searchableSetting("start-from-origin")}
      description={gt(
        "Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing.",
      )}
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            ariaLabel={gt("Reset new worktrees start from remote to default")}
            onClick={() =>
              updateSettings({
                newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["newWorktreesStartFromOrigin"]}
          checked={settings.newWorktreesStartFromOrigin}
          onCheckedChange={(checked) =>
            updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
          }
          aria-label={gt("Start new worktrees from remote by default")}
        />
      }
    />
  );
}

function WorktreeBranchPrefixRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedWorktreeBranchPrefix = useScopedSettingsMixed(["worktreeBranchPrefix"]);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeBranchPrefix"]}
      {...searchableSetting("worktree-branch-prefix")}
      description={gt("Prefix for generated worktree branch names. Leave blank for no prefix.")}
      resetAction={
        settings.worktreeBranchPrefix !== DEFAULT_UNIFIED_SETTINGS.worktreeBranchPrefix ? (
          <SettingResetButton
            ariaLabel={gt("Reset worktree branch prefix to default")}
            onClick={() =>
              updateSettings({
                worktreeBranchPrefix: DEFAULT_UNIFIED_SETTINGS.worktreeBranchPrefix,
              })
            }
          />
        ) : null
      }
      control={
        <DraftInput
          size="sm"
          className="w-full sm:w-44"
          value={mixedWorktreeBranchPrefix ? "" : settings.worktreeBranchPrefix}
          placeholder={mixedWorktreeBranchPrefix ? gt("Mixed") : gt("No prefix")}
          spellCheck={false}
          aria-label={gt("Worktree branch prefix")}
          onCommit={(value) => {
            const worktreeBranchPrefix = /[a-z0-9]/i.test(value)
              ? sanitizeBranchFragment(value)
              : "";
            if (worktreeBranchPrefix !== settings.worktreeBranchPrefix) {
              updateSettings({ worktreeBranchPrefix });
            }
          }}
        />
      }
    />
  );
}

export function WorktreesSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="worktree-creation"
        title={gt("Creation", { $context: "settings section about creating worktrees" })}
      >
        {!isProjectScope && <WorktreesDirectoryRow />}
        <StartFromRemoteRow />
        <AdvancedSettings targetIds={[searchableSetting("worktree-submodules").id]}>
          <WorktreeSubmodulesRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection id="worktree-branches" title={gt("Branches")}>
        {/* A server setting with no per-project override. */}
        {!isProjectScope && <WorktreeBranchPrefixRow />}
        <BranchNamingSettings />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}
