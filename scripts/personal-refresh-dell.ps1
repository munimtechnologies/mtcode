# Install staged personal T3 Code build on Dell (copied from Mac orchestrator).
$ErrorActionPreference = "Stop"
Write-Output "DELL_INSTALL_START"

Get-Process | Where-Object { $_.ProcessName -like "*T3*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

try {
  winget uninstall --id T3Tools.T3Code --silent --disable-interactivity 2>&1 | Out-String | Write-Output
} catch {}

foreach ($name in @(
  "Uninstall T3 Code (Nightly).exe",
  "Uninstall T3 Code (Alpha).exe",
  "Uninstall T3 Code.exe"
)) {
  $u = Join-Path $env:LOCALAPPDATA "Programs\t3code\$name"
  if (Test-Path $u) {
    Start-Process -FilePath $u -ArgumentList "/S" -Wait
  }
}

$installer = Join-Path $env:USERPROFILE "dev\T3-Code-personal-x64.exe"
if (-not (Test-Path $installer)) {
  throw "Missing installer at $installer"
}

Write-Output "installing $installer"
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Start-Sleep 2

$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\t3code\T3 Code*.exe") |
  Where-Object { $_.Name -notlike "Uninstall*" } |
  Select-Object -First 1

if (-not $exe) {
  throw "T3 Code exe not found after install"
}

Start-Process $exe.FullName
Write-Output ("DELL_REFRESHED " + $exe.Name)
