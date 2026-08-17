$ErrorActionPreference = "Stop"
Write-Output "DELL_INSTALL_START"

Get-Process | Where-Object {
  $_.ProcessName -like "*T3*" -or $_.Path -like "*t3code*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

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

$src = Join-Path $env:USERPROFILE "dev\T3-Code-personal-x64.exe"
if (-not (Test-Path $src)) { throw "Missing installer at $src" }

# Copy so Start-Process isn't blocked by a file lock on the scp target
$installer = Join-Path $env:TEMP ("T3-Code-personal-{0}.exe" -f (Get-Date -Format "yyyyMMddHHmmss"))
Copy-Item -Force $src $installer
Write-Output "installing $installer"
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Start-Sleep 2
Remove-Item -Force $installer -ErrorAction SilentlyContinue

$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\t3code\T3 Code*.exe") |
  Where-Object { $_.Name -notlike "Uninstall*" } |
  Select-Object -First 1

if (-not $exe) { throw "T3 Code exe not found after install" }

Start-Process $exe.FullName
Write-Output ("DELL_REFRESHED " + $exe.Name)
