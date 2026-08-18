# Munim T3 Connect client configuration loader for Windows build hosts.
# PowerShell mirror of scripts/lib/personal-munim-connect-env.sh - see that
# file for the activation model. Dot-source this from the repo clone after
# checkout, then call Import-MunimConnectEnv -Repo <clone path>.
#
# Reads %USERPROFILE%\.mt\munim-connect.env (synced from the Mac by
# scripts/personal-refresh-windows.sh). Public identifiers only; never put
# CLERK_SECRET_KEY in that file.

$script:MunimConnectEnvFile = Join-Path $env:USERPROFILE ".mt\munim-connect.env"
$script:MunimConnectT3Pk = "pk_live_Y2xlcmsudDMuY29kZXMk"
$script:MunimConnectT3RelayHost = "relay.t3.codes"
$script:MunimConnectT3OAuthId = "hzxSgY2cH10sDU2r"
$script:MunimConnectVarNames = @(
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "T3CODE_RELAY_URL",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID"
)

function Read-MunimConnectValues {
  $values = @{}
  if (-not (Test-Path $script:MunimConnectEnvFile)) { return $values }
  foreach ($line in Get-Content $script:MunimConnectEnvFile) {
    $trimmed = ([string]$line).Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $idx = $trimmed.IndexOf("=")
    if ($idx -lt 1) { continue }
    $name = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim().Trim('"')
    if ($value) { $values[$name] = $value }
  }
  return $values
}

# Loads the Munim Connect config into the process environment. Returns $true
# when active. Missing/incomplete file returns $false (build proceeds exactly
# as today). A file carrying T3's production values throws.
function Import-MunimConnectEnv {
  param([string]$Repo = "")
  $values = Read-MunimConnectValues
  if ($values.Count -eq 0) { return $false }

  $required = @("T3CODE_CLERK_PUBLISHABLE_KEY", "T3CODE_CLERK_JWT_TEMPLATE", "T3CODE_RELAY_URL")
  $missing = @($required | Where-Object { -not $values[$_] })
  if ($missing.Count -gt 0) {
    Write-Warning "munim-connect: $($script:MunimConnectEnvFile) is missing $($missing -join ', ') - building without Munim Connect"
    return $false
  }

  if (($values["T3CODE_CLERK_PUBLISHABLE_KEY"] -eq $script:MunimConnectT3Pk) -or
    ($values["T3CODE_RELAY_URL"] -like "*$($script:MunimConnectT3RelayHost)*") -or
    ($values["T3CODE_CLERK_CLI_OAUTH_CLIENT_ID"] -eq $script:MunimConnectT3OAuthId)) {
    throw "munim-connect: $($script:MunimConnectEnvFile) contains T3/pingdotgg production values - refusing to build with them"
  }

  foreach ($name in $script:MunimConnectVarNames) {
    if ($values[$name]) {
      Set-Item -Path ("Env:{0}" -f $name) -Value $values[$name]
    }
  }
  if ($Repo) { Write-MunimConnectRepoEnv -Repo $Repo }
  return $true
}

# Rewrites <repo>\.env from the loaded values so none of T3's identifiers
# linger in the clone. Only touches a .env that is missing, an untouched copy
# of .env.example, or one this helper wrote earlier.
function Write-MunimConnectRepoEnv {
  param([Parameter(Mandatory = $true)][string]$Repo)
  $envPath = Join-Path $Repo ".env"
  $examplePath = Join-Path $Repo ".env.example"
  if (Test-Path $envPath) {
    $first = [string](Get-Content $envPath -TotalCount 1)
    $isManaged = $first -match "munim-connect: managed"
    $isExampleCopy = (Test-Path $examplePath) -and
      ((Get-Content $envPath -Raw) -eq (Get-Content $examplePath -Raw))
    if (-not $isManaged -and -not $isExampleCopy) {
      Write-Warning "munim-connect: leaving hand-edited $envPath in place (process env still overrides Connect identifiers)"
      return
    }
  }
  $lines = @("# munim-connect: managed - regenerated from $($script:MunimConnectEnvFile) by scripts/lib/personal-munim-connect-env.ps1")
  foreach ($name in $script:MunimConnectVarNames) {
    $item = Get-Item -Path ("Env:{0}" -f $name) -ErrorAction SilentlyContinue
    if ($item -and $item.Value) { $lines += "$name=$($item.Value)" }
  }
  Set-Content -Path $envPath -Value $lines -Encoding utf8
}
