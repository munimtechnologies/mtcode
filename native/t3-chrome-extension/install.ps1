# Register the native messaging host so Chrome can reach the desktop server.
#
# The Windows counterpart to install.sh. Chrome finds hosts through the registry
# here rather than a directory of manifests, and it runs the host with no
# arguments, so the manifest points at a small .cmd that re-execs the server in
# host mode.
#
# The extension id is pinned by the "key" in manifest.json, which is why this
# can be registered before the extension is ever loaded.

$ErrorActionPreference = 'Stop'

$ExtensionId = 'kgdolgnijopbghhomnblabjkmjhnoage'
$HostName = 'com.munim.mtcode.desktop'
# Extensions that have not reloaded since the rename still ask for the old id,
# and Chrome refuses a host it has no manifest for. Register both names.
$LegacyHostName = 'com.t3tools.t3code.desktop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$binary = $env:T3CODE_DESKTOP_MCP_PATH
if (-not $binary) {
  $binary = Join-Path $here '..\t3-desktop-mcp-rs\target\release\t3-desktop-mcp.exe'
}
if (-not (Test-Path $binary)) {
  Write-Error "desktop server binary not found at: $binary`nbuild it first:  cargo build --release --manifest-path native/t3-desktop-mcp-rs/Cargo.toml"
}
$binary = (Resolve-Path $binary).Path

$support = Join-Path $env:LOCALAPPDATA 't3-desktop-mcp'
New-Item -ItemType Directory -Force -Path $support | Out-Null

# Chrome passes no arguments to a host, so the wrapper supplies the mode.
# Write UTF-8 without BOM: ASCII would corrupt non-ASCII path characters, and
# PowerShell's "UTF8" encoding inserts a BOM that some hosts mishandle.
$wrapper = Join-Path $support 'native-host.cmd'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  $wrapper,
  "@echo off`r`n`"$binary`" native-host",
  $utf8NoBom
)

$manifestPaths = @{}
foreach ($name in @($HostName, $LegacyHostName)) {
  $path = Join-Path $support "$name.json"
  $manifest = [ordered]@{
    name            = $name
    description     = 'MT Code desktop control bridge'
    path            = $wrapper
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  # Chrome rejects native-host manifests with a UTF-8 BOM (PowerShell's UTF8
  # encoding inserts one). Write UTF-8 without BOM explicitly.
  [System.IO.File]::WriteAllText(
    $path,
    ($manifest | ConvertTo-Json -Depth 4),
    $utf8NoBom
  )
  $manifestPaths[$name] = $path
}
$manifestPath = $manifestPaths[$HostName]

# Chrome and Chromium read separate registry trees; register wherever the
# browser is actually installed.
$installed = 0
foreach ($vendor in @('Google\Chrome', 'Google\Chrome Beta', 'Chromium')) {
  try {
    foreach ($name in @($HostName, $LegacyHostName)) {
      $key = "HKCU:\Software\$vendor\NativeMessagingHosts\$name"
      New-Item -Path $key -Force | Out-Null
      Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPaths[$name]
    }
    Write-Host "registered host in: HKCU\Software\$vendor"
    $installed++
  } catch {
    # A browser that is not installed simply has no tree; not an error.
  }
}

if ($installed -eq 0) {
  Write-Error 'no Chrome registry location could be written'
}

Write-Host ''
Write-Host 'Next, load the extension once:'
Write-Host '  1. open  chrome://extensions'
Write-Host '  2. turn on Developer mode'
Write-Host "  3. Load unpacked  ->  $here"
Write-Host ''
Write-Host "It should appear with id $ExtensionId."
