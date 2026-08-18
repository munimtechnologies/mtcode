$ErrorActionPreference = "Stop"
Write-Output "DELL_INSTALL_START"

Get-Process | Where-Object {
  $_.ProcessName -like "*T3*" -or $_.ProcessName -like "*MT Code*" -or
  $_.Path -like "*t3code*" -or $_.Path -like "*mtcode*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

try {
  winget uninstall --id T3Tools.T3Code --silent --disable-interactivity 2>&1 | Out-String | Write-Output
} catch {}

# Both brands: the fleet used to ship the plain T3 Code identity, so its uninstaller
# lingers on machines that have not been wiped since the MT Code switch.
foreach ($entry in @(
  @{ Dir = "t3code"; Name = "Uninstall T3 Code (Nightly).exe" },
  @{ Dir = "t3code"; Name = "Uninstall T3 Code (Alpha).exe" },
  @{ Dir = "t3code"; Name = "Uninstall T3 Code.exe" },
  @{ Dir = "mtcode"; Name = "Uninstall MT Code.exe" }
)) {
  $u = Join-Path $env:LOCALAPPDATA ("Programs\{0}\{1}" -f $entry.Dir, $entry.Name)
  if (Test-Path $u) {
    Start-Process -FilePath $u -ArgumentList "/S" -Wait
  }
}

$src = Join-Path $env:USERPROFILE "dev\MT-Code-personal-x64.exe"
if (-not (Test-Path $src)) { throw "Missing installer at $src" }

# Copy so Start-Process isn't blocked by a file lock on the scp target
$installer = Join-Path $env:TEMP ("MT-Code-personal-{0}.exe" -f (Get-Date -Format "yyyyMMddHHmmss"))
Copy-Item -Force $src $installer
Write-Output "installing $installer"
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Start-Sleep 2
Remove-Item -Force $installer -ErrorAction SilentlyContinue

$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\mtcode\MT Code*.exe") |
  Where-Object { $_.Name -notlike "Uninstall*" } |
  Select-Object -First 1

if (-not $exe) { throw "MT Code exe not found after install" }

# Not Start-Process: this runs over SSH, in session 0, which has no desktop -- the app started
# there and Dell's screen stayed empty. The launcher runs it in the logged-on user's session and
# reports whether a window actually appeared.
$launcher = Join-Path $PSScriptRoot "personal-launch-gui.ps1"
if (Test-Path $launcher) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -ExePath $exe.FullName 2>&1 |
    ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE -ne 0) { Write-Output "DELL_GUI_NOT_SHOWN is anyone logged on?" }
} else {
  Write-Output "no launcher beside this script; falling back to a session 0 start"
  Start-Process $exe.FullName
}
Write-Output ("DELL_REFRESHED " + $exe.Name)
