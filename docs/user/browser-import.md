# Import browser sessions

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Integrations → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag T3 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen T3 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

On Windows, import supports Firefox and Helium profiles that use standard profile encryption.
Other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies
are skipped on all platforms.

## Separate task logins

For parallel tasks that need different logins, create a **Blank profile** for each task under
**Settings → Integrations → Browser profiles → Add profile**. In the panel tab bar, open
**+ → Browser** and choose that profile.

Agents can read an open tab's `profileId` with `preview_status` and pass that ID to `preview_open`
to create another tab in the same profile. The built-in IDs are `default` and `incognito`;
custom profiles use their ID, not their display name. For example:

```json
{ "profileId": "incognito", "url": "http://localhost:3001" }
```

Supplying `profileId` always creates a new tab. It cannot be combined with `tabId` or
`reuseExistingTab: true`. Subsequent agent actions use the new tab, and the original tab keeps its
profile and login. Unknown profiles are rejected; this does not create a profile.

A new tab shares cookies with other tabs in its profile. Incognito is also shared within an
environment until T3 Code closes, so use separate blank profiles for independent tasks. Both the
server and desktop must support explicit profile selection; an older desktop cannot handle it.
