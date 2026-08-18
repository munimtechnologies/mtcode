# Install the personal build on Dell from Blade, over the local network.
#
# Dell is normally reached from the Mac through a Cloudflare tunnel. That tunnel is the least
# reliable part of the fleet -- when it is down the Mac cannot see Dell at all, and Dell silently
# falls behind every refresh. Blade sits on the same LAN and already holds the same key, so it can
# reach Dell directly when the tunnel cannot.
#
# Runs on Blade. Everything it needs is already there: the staged installer it just built, and
# ~/.ssh/codex_ed25519.
$ErrorActionPreference = "Stop"

# By name rather than address: the LAN hands these out by DHCP, and the name is what survives.
$dellHost = if ($env:T3_DELL_HOST) { $env:T3_DELL_HOST } else { "DESKTOP-6ILJVR4" }
$dellUser = if ($env:T3_DELL_USER) { $env:T3_DELL_USER } else { "busin" }
$key = Join-Path $env:USERPROFILE ".ssh\codex_ed25519"
$installer = Join-Path $env:USERPROFILE "dev\MT-Code-x64.exe"
$script = Join-Path $env:USERPROFILE "dev\personal-refresh-dell.ps1"
$launcher = Join-Path $env:USERPROFILE "dev\personal-launch-gui.ps1"

if (-not (Test-Path $installer)) { throw "no staged installer at $installer" }
if (-not (Test-Path $script)) { throw "no Dell refresh script at $script" }
if (-not (Test-Path $key)) { throw "no ssh key at $key" }

$target = "$dellUser@$dellHost"
$sshArgs = @("-i", $key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20")

Write-Output "DELL_VIA_BLADE_START $target"

& scp @sshArgs $installer "${target}:dev/MT-Code-x64.exe"
if ($LASTEXITCODE -ne 0) { throw "could not copy the installer to $target" }

& scp @sshArgs $script "${target}:dev/personal-refresh-dell.ps1"
if ($LASTEXITCODE -ne 0) { throw "could not copy the refresh script to $target" }

# Beside it, because the refresh script launches through it -- without this Dell falls back to a
# session 0 start and its screen stays empty.
if (Test-Path $launcher) {
  & scp @sshArgs $launcher "${target}:dev/personal-launch-gui.ps1"
  if ($LASTEXITCODE -ne 0) { throw "could not copy the launcher to $target" }
}

& ssh @sshArgs $target "powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/$dellUser/dev/personal-refresh-dell.ps1"
if ($LASTEXITCODE -ne 0) { throw "the refresh script failed on $target" }

Write-Output "DELL_VIA_BLADE_OK"
