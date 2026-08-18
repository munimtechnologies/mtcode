# Refresh Blade to latest personal fork (upstream nightly + CU/History).
# Clone remote "origin" here is github.com/sheehanmunim/mtcode (personal branch).
# Uses T3CODE_DESKTOP_VERSION (nightly string) for Nightly logo/artwork.
# The fleet ships the MT Code brand on every machine, same as the Mac.
param(
  [string]$DesktopVersion = "",
  [string]$ForceRebuild = ""
)

$ErrorActionPreference = "Stop"
if ($DesktopVersion) { $env:T3CODE_DESKTOP_VERSION = $DesktopVersion }
if ($ForceRebuild) { $env:T3_FORCE_REBUILD = $ForceRebuild }
$env:T3CODE_DESKTOP_DISTRO = "munim"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" +
  "$env:USERPROFILE\.vite-plus\bin;" +
  "$env:USERPROFILE\.cargo\bin"

$repo = Join-Path $env:USERPROFILE "dev\t3code-personal"
$logDir = Join-Path $env:USERPROFILE "dev\t3-personal-logs"
$stateFile = Join-Path $logDir "last-built-sha"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("refresh-{0:yyyyMMdd}.log" -f (Get-Date))
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $msg
  Add-Content -Path $log -Value $line -Encoding ascii
  Write-Output $line
}

Log "refresh start"
Log ("args DesktopVersion=$DesktopVersion ForceRebuild=$ForceRebuild envVersion=$($env:T3CODE_DESKTOP_VERSION) envForce=$($env:T3_FORCE_REBUILD)")

if (-not (Test-Path $repo)) {
  git clone --branch personal --single-branch https://github.com/sheehanmunim/mtcode.git $repo
}
Set-Location $repo
git fetch origin personal
$new = (git rev-parse origin/personal).Trim()
$old = ""
if (Test-Path $stateFile) {
  $old = (Get-Content $stateFile -Raw).Trim()
}
Log "origin/personal=$new previously=$old"

$staged = Join-Path $env:USERPROFILE "dev\MT-Code-personal-x64.exe"
$force = [string]$env:T3_FORCE_REBUILD
if (($new -eq $old) -and ($force -ne "1")) {
  if (Test-Path $staged) {
    Log "no changes - skipping rebuild"
    exit 0
  }
  Log "no changes but staged installer missing - rebuilding"
}

git checkout personal
git reset --hard origin/personal

# Bake T3 Connect public client config into desktop artifacts (gitignored .env).
# Without this, hasCloudPublicConfig() is false and Connect UI is omitted.
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Log "created .env from .env.example for T3 Connect"
}

if (-not $env:T3CODE_DESKTOP_VERSION) {
  # Avoid jq regex on Windows; parse JSON in PowerShell.
  $releases = ConvertFrom-Json -InputObject (gh api "repos/pingdotgg/t3code/releases" --paginate)
  $nightly = $releases |
    Where-Object { $_.prerelease -eq $true -and $_.tag_name -match "nightly" } |
    Sort-Object { [datetime]$_.published_at } -Descending |
    Select-Object -First 1
  if (-not $nightly -or -not $nightly.tag_name) { throw "could not resolve latest nightly tag" }
  $env:T3CODE_DESKTOP_VERSION = ([string]$nightly.tag_name).TrimStart("v")
}
Log "T3CODE_DESKTOP_VERSION=$($env:T3CODE_DESKTOP_VERSION)"

Log ("HEAD=" + (git rev-parse --short HEAD) + " " + (git log -1 --oneline))
# pnpm writes progress to stderr; with Stop that becomes a terminating error.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
# Align package versions like upstream's release workflow, so the bundled
# server and web report this nightly version instead of the stale package.json
# one (else nightly-track clients show "Server update available").
& node scripts/update-release-package-versions.ts $env:T3CODE_DESKTOP_VERSION *>> $log
if ($LASTEXITCODE -ne 0) {
  Log "version stamp failed exit=$LASTEXITCODE"
  exit $LASTEXITCODE
}
& pnpm dist:desktop:win:x64 *>> $log
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($buildExit -ne 0) {
  Log "build failed exit=$buildExit"
  exit $buildExit
}
# The stamp is build input only; keep the clone clean.
git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json

$installerPath = Get-ChildItem (Join-Path $repo "release\MT-Code-*-x64.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
Copy-Item $installerPath $staged -Force
Log "staged installer $staged"

Log "stopping T3 / MT Code"
Get-Process | Where-Object { $_.ProcessName -like "*T3*" -or $_.ProcessName -like "*MT Code*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Log "uninstalling previous installs if present"
try {
  winget uninstall --id T3Tools.T3Code --silent --disable-interactivity 2>&1 | Out-String | ForEach-Object { Log $_ }
} catch {}
# Both brands: the fleet used to ship the plain T3 Code identity, so its uninstaller
# lingers on machines that have not been wiped since the MT Code switch.
foreach ($entry in @(
  @{ Dir = "t3code"; Name = "Uninstall T3 Code (Nightly).exe" },
  @{ Dir = "t3code"; Name = "Uninstall T3 Code (Alpha).exe" },
  @{ Dir = "t3code"; Name = "Uninstall T3 Code.exe" },
  @{ Dir = "mtcode"; Name = "Uninstall MT Code.exe" }
)) {
  $uninst = Join-Path $env:LOCALAPPDATA ("Programs\{0}\{1}" -f $entry.Dir, $entry.Name)
  if (Test-Path $uninst) {
    Start-Process -FilePath $uninst -ArgumentList "/S" -Wait
  }
}

Log "installing $installerPath"
Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
Start-Sleep 2
$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\mtcode\MT Code*.exe") |
  Where-Object { $_.Name -notlike "Uninstall*" } |
  Select-Object -First 1
if ($exe) {
  Log "launching $($exe.Name)"
  # Not Start-Process: this script runs over SSH, in session 0, which has no desktop -- the app
  # started there and the machine's screen stayed empty. The launcher runs it in the logged-on
  # user's session instead and reports whether a window actually appeared.
  $launcher = Join-Path $PSScriptRoot "personal-launch-gui.ps1"
  if (Test-Path $launcher) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -ExePath $exe.FullName 2>&1 |
      ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Log "the GUI could not be shown -- is anyone logged on?" }
  } else {
    Log "no launcher beside this script; falling back to a session 0 start"
    Start-Process $exe.FullName
  }
}
Set-Content -Path $stateFile -Value $new -Encoding ascii
Log "refresh done"
