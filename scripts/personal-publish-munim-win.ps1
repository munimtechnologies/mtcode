# Build public Munim Windows installer (appId com.munim.t3code) on Blade.
param(
  [Parameter(Mandatory = $true)][string]$DesktopVersion,
  [string]$UpdateRepository = "sheehanmunim/t3code"
)

$ErrorActionPreference = "Stop"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" +
  "$env:USERPROFILE\.vite-plus\bin;" +
  "$env:USERPROFILE\.cargo\bin"

$repo = Join-Path $env:USERPROFILE "dev\t3code-personal"
$logDir = Join-Path $env:USERPROFILE "dev\t3-personal-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("publish-munim-{0:yyyyMMdd}.log" -f (Get-Date))
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $msg
  Add-Content -Path $log -Value $line -Encoding ascii
  Write-Output $line
}

Log "munim win publish start"
Log "DesktopVersion=$DesktopVersion UpdateRepository=$UpdateRepository"

if (-not (Test-Path $repo)) {
  git clone --branch personal --single-branch https://github.com/sheehanmunim/t3code.git $repo
}
Set-Location $repo
git fetch origin personal
git checkout personal
git reset --hard origin/personal

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Log "created .env from .env.example"
}

$env:T3CODE_DESKTOP_DISTRO = "munim"
$env:T3CODE_DESKTOP_UPDATE_REPOSITORY = $UpdateRepository
$env:GITHUB_REPOSITORY = $UpdateRepository
$env:T3CODE_DESKTOP_VERSION = $DesktopVersion
Remove-Item Env:T3CODE_DESKTOP_SIGNED -ErrorAction SilentlyContinue

Log "HEAD=$(git rev-parse --short HEAD) T3CODE_DESKTOP_DISTRO=$($env:T3CODE_DESKTOP_DISTRO) VERSION=$($env:T3CODE_DESKTOP_VERSION)"

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed: $LASTEXITCODE" }
# Align package versions like upstream's release workflow, so the bundled
# server and web report this nightly version (else nightly-track clients
# show "Server update available").
node scripts/update-release-package-versions.ts $env:T3CODE_DESKTOP_VERSION
if ($LASTEXITCODE -ne 0) { throw "version stamp failed: $LASTEXITCODE" }
pnpm dist:desktop:win:x64
if ($LASTEXITCODE -ne 0) { throw "pnpm dist:desktop:win:x64 failed: $LASTEXITCODE" }
$ErrorActionPreference = $prevEap
# The stamp is build input only; keep the clone clean.
git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json

$exe = Get-ChildItem (Join-Path $repo "release\T3-Code-Munim-*-x64.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $exe) { throw "Munim Windows exe not found in release/" }
Log "built $($exe.FullName)"
Write-Output $exe.FullName
