# Refresh Blade to latest personal fork (upstream nightly + CU/History).
# Rebuilds only when origin/personal moved (unless T3_FORCE_REBUILD=1).
$ErrorActionPreference = "Stop"
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
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

Log "refresh start"

if (-not (Test-Path $repo)) {
  git clone --branch personal --single-branch https://github.com/sheehanmunim/t3code.git $repo
}
Set-Location $repo
git fetch origin personal
$new = (git rev-parse origin/personal).Trim()
$old = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { "" }
Log "origin/personal=$new previously=$old"

$staged = Join-Path $env:USERPROFILE "dev\T3-Code-personal-x64.exe"
if ($new -eq $old -and -not $env:T3_FORCE_REBUILD) {
  if (Test-Path $staged) {
    Log "no changes — skipping rebuild"
    exit 0
  }
  Log "no changes but staged installer missing — rebuilding"
}

git checkout personal
git reset --hard origin/personal
Log ("HEAD=" + (git rev-parse --short HEAD) + " " + (git log -1 --oneline))
& pnpm dist:desktop:win:x64 *>> $log
if ($LASTEXITCODE -ne 0) { Log "build failed"; exit $LASTEXITCODE }

$installerPath = Get-ChildItem (Join-Path $repo "release\T3-Code-*-x64.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
Copy-Item $installerPath $staged -Force
Log "staged installer $staged"

Log "stopping T3"
Get-Process | Where-Object { $_.ProcessName -like "*T3*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Log "uninstalling official Nightly if present"
try {
  winget uninstall --id T3Tools.T3Code --silent --disable-interactivity 2>&1 | Out-String | ForEach-Object { Log $_ }
} catch {}
$nightlyUninst = Join-Path $env:LOCALAPPDATA "Programs\t3code\Uninstall T3 Code (Nightly).exe"
if (Test-Path $nightlyUninst) {
  Start-Process -FilePath $nightlyUninst -ArgumentList "/S" -Wait
}

Log "installing $installerPath"
Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
Start-Sleep 2
Log "launching Alpha"
Start-Process (Join-Path $env:LOCALAPPDATA "Programs\t3code\T3 Code (Alpha).exe")
Set-Content -Path $stateFile -Value $new -Encoding utf8
Log "refresh done"
