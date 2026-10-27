import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { sanitizeBranchFragment } from "@t3tools/shared/git";

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
import { searchableSetting } from "./settingsSearch";
import { WorktreeCleanupSection, WorktreesDirectoryRow } from "./StorageSettings";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function StartFromRemoteRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      {...searchableSetting("start-from-origin")}
      description="Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing."
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            label="new worktrees start from remote"
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
          aria-label="Start new worktrees from remote by default"
        />
      }
    />
  );
}

function WorktreeBranchPrefixRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedWorktreeBranchPrefix = useScopedSettingsMixed(["worktreeBranchPrefix"]);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeBranchPrefix"]}
      {...searchableSetting("worktree-branch-prefix")}
      description="Prefix for generated worktree branch names. Leave blank for no prefix."
      resetAction={
        settings.worktreeBranchPrefix !== DEFAULT_UNIFIED_SETTINGS.worktreeBranchPrefix ? (
          <SettingResetButton
            label="worktree branch prefix"
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
          placeholder={mixedWorktreeBranchPrefix ? "Mixed" : "No prefix"}
          spellCheck={false}
          aria-label="Worktree branch prefix"
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
  const { scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer>
      <SettingsSection id="worktree-creation" title="Creation">
        {!isProjectScope && <WorktreesDirectoryRow />}
        <StartFromRemoteRow />
        <AdvancedSettings targetIds={[searchableSetting("worktree-submodules").id]}>
          <WorktreeSubmodulesRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection id="worktree-branches" title="Branches">
        {/* A server setting with no per-project override. */}
        {!isProjectScope && <WorktreeBranchPrefixRow />}
        <BranchNamingSettings />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}
