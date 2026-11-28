# Import browser sessions

Import cookies from another browser into the desktop app's [preview browser](./browser.md) so you can reuse existing signed-in sessions.

## Import a profile

1. Close the source browser.
2. Open **Settings → Browser → Browser profiles → Add profile** and choose a browser under **Import from**.
3. Allow any OS keyring unlock prompt.

This is a one-time copy—later login changes stay separate, and some sites may still require signing in again.

## Platform notes

- **macOS (Safari)**: Requires temporary **Full Disk Access** (grant in System Settings, quit/reopen T3 Code if macOS requires it, then reopen the import wizard). You can revoke Full Disk Access afterward.
- **Windows**: Supports Firefox, Zen, and Helium profiles using standard encryption. Other Chromium browsers use app-bound encryption and cannot be imported.
- Partitioned cookies are skipped on all platforms. Administrators can disable cookie import via [managed policy](./managed-policy.md#other-capabilities).

## Separate task logins

For parallel tasks that need different logins, create a **Blank profile** for each task under **Settings → Browser → Browser profiles → Add profile**, then open **+ → Browser** in the panel tab bar and choose that profile.

Agents can read an open tab's `profileId` with `preview_status` and pass it to `preview_open` to create another tab in the same profile. The built-in IDs are `default` and `incognito`; custom profiles use their ID, not their display name:

```json
{ "profileId": "incognito", "url": "http://localhost:3001" }
```

- Supplying `profileId` always creates a new tab; it cannot be combined with `tabId` or `reuseExistingTab: true`. Later agent actions use the new tab, and the original tab keeps its profile and login. Unknown profiles are rejected rather than created.
- A new tab shares cookies with other tabs in its profile. Incognito is also shared within an environment until the app closes, so use separate blank profiles for independent tasks.
- Both the server and desktop must support explicit profile selection; an older desktop cannot handle it.
