# Deploys the CWT Tax Exposure Portal on this Windows Server:
#   - builds the server (TypeScript -> dist/) and applies pending Prisma
#     migrations against the server's own PostgreSQL
#   - builds the client for production (relative /api calls, so it works
#     through the IIS reverse proxy with no CORS/port juggling)
#   - installs/updates an NSSM service running the backend on port 7171
#   - creates/updates an IIS site serving the client build on port 7070,
#     with a web.config that reverse-proxies /api/* to the backend and
#     falls back to index.html for React Router's client-side routes
#
# Prerequisites this script does NOT install for you (check first):
#   - Node.js on PATH (`node -v`)
#   - NSSM on PATH (`nssm.exe`  -  https://nssm.cc) or pass -NssmExe
#   - IIS with the URL Rewrite and Application Request Routing (ARR)
#     modules  -  https://www.iis.net/downloads/microsoft/url-rewrite and
#     https://www.iis.net/downloads/microsoft/application-request-routing
#   - A reachable PostgreSQL instance (server/.env's DATABASE_URL)
#
# Usage (run as Administrator, from anywhere):
#   powershell -ExecutionPolicy Bypass -File deploy\deploy-iis.ps1
#
# Safe to re-run  -  every step below checks current state before changing it.

param(
    [string]$RepoRoot = 'C:\cwt-tax-portal',
    [string]$SiteName = 'CWT Tax Portal',
    [int]$FrontendPort = 7070,
    [int]$BackendPort = 7171,
    [string]$ServiceName = 'CwtTaxPortalServer',
    [string]$NodeExe = 'node',
    [string]$NssmExe = 'nssm'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# --- Preflight checks -------------------------------------------------------

Write-Step "Checking prerequisites"

if (-not (Test-Path $RepoRoot)) {
    throw "RepoRoot '$RepoRoot' does not exist  -  copy/clone the repo there first."
}

try { $nodeVersion = & $NodeExe -v } catch { throw "Node.js not found (tried '$NodeExe'). Install it or pass -NodeExe <path>." }
Write-Ok "Node.js $nodeVersion"

try { & $NssmExe version | Out-Null } catch { throw "NSSM not found (tried '$NssmExe'). Install it (https://nssm.cc) or pass -NssmExe <path>." }
Write-Ok "NSSM found"

$rewriteDll = Join-Path $env:SystemRoot 'System32\inetsrv\rewrite.dll'
if (-not (Test-Path $rewriteDll)) {
    Write-Warn2 "IIS URL Rewrite module not detected at $rewriteDll  -  the reverse-proxy rule in web.config will not work until it's installed."
    Write-Warn2 "https://www.iis.net/downloads/microsoft/url-rewrite"
}
$arrDll = Join-Path ${env:ProgramFiles} 'IIS\Application Request Routing\requestRouter.dll'
if (-not (Test-Path $arrDll)) {
    Write-Warn2 "Application Request Routing (ARR) not detected at $arrDll  -  /api requests will not be proxied to the backend until it's installed."
    Write-Warn2 "https://www.iis.net/downloads/microsoft/application-request-routing"
}

if (-not (Test-Path (Join-Path $RepoRoot 'server\.env'))) {
    throw "server\.env is missing at $RepoRoot  -  copy it from deploy\migrate-data.ps1's output, or fill in server\.env.production.example and save it as server\.env, before running this script."
}

# --- Stop the backend first (if it's running from a previous deploy) -------
# Windows locks a running process's files (in particular the Prisma query
# engine's .dll.node) -- overwriting dist\ while the old build is still
# running fails with EPIPE/EBUSY. Stop it now, start it fresh at the end.

$existingSvc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingSvc -and $existingSvc.Status -ne 'Stopped') {
    Write-Step "Stopping '$ServiceName' so the build can overwrite its files"
    & $NssmExe stop $ServiceName | Out-Null
    try {
        $existingSvc.WaitForStatus('Stopped', (New-TimeSpan -Seconds 30))
        Write-Ok "Stopped"
    } catch {
        throw "'$ServiceName' did not stop within 30s -- stop it manually (nssm stop $ServiceName) and re-run."
    }
}

# --- Build the server ---------------------------------------------------

Write-Step "Building server"
Push-Location (Join-Path $RepoRoot 'server')
try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install (server) failed" }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build (server) failed" }
    & npx prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    Write-Step "Applying database migrations"
    & npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed" }
    New-Item -ItemType Directory -Force -Path 'logs' | Out-Null
} finally {
    Pop-Location
}
Write-Ok "Server built and migrated"

# --- Build the client -----------------------------------------------------

Write-Step "Building client (relative /api URLs, for the IIS reverse proxy)"
Push-Location (Join-Path $RepoRoot 'client')
try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install (client) failed" }
    # NOT $env:VITE_API_URL = '' -- on Windows, setting an environment
    # variable to an empty string actually DELETES it (SetEnvironmentVariable
    # with an empty value removes the variable; Windows has no concept of a
    # zero-length env var), so vite build would never see it as set at all
    # and would silently fall back to the http://<host>:4100 dev default.
    # A .env file doesn't go through the OS environment at all -- Vite
    # parses it directly -- so an explicitly-empty value works correctly.
    $envLocalFile = '.env.production.local'
    'VITE_API_URL=' | Set-Content -Encoding UTF8 $envLocalFile
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build (client) failed" }
    } finally {
        Remove-Item $envLocalFile -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}
Write-Ok "Client built to client\dist"

Write-Step "Writing web.config into client\dist"
$webConfigTemplate = Join-Path $PSScriptRoot 'web.config'
$webConfigOut = Join-Path $RepoRoot 'client\dist\web.config'
(Get-Content $webConfigTemplate -Raw) -replace '__BACKEND_PORT__', $BackendPort | Set-Content -Encoding UTF8 $webConfigOut
Write-Ok "web.config written (backend port $BackendPort)"

# --- Backend service (NSSM) ------------------------------------------------

Write-Step "Installing/updating the backend NSSM service ('$ServiceName')"
$serverDir = Join-Path $RepoRoot 'server'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    & $NssmExe install $ServiceName $NodeExe 'dist\index.js'
    if ($LASTEXITCODE -ne 0) { throw "nssm install failed" }
    Write-Ok "Service installed"
} else {
    Write-Ok "Service already exists  -  updating its settings"
}
& $NssmExe set $ServiceName AppDirectory $serverDir
& $NssmExe set $ServiceName AppEnvironmentExtra "PORT=$BackendPort"
& $NssmExe set $ServiceName AppStdout (Join-Path $serverDir 'logs\service-out.log')
& $NssmExe set $ServiceName AppStderr (Join-Path $serverDir 'logs\service-err.log')
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName Start SERVICE_AUTO_START

Write-Step "Starting service"
& $NssmExe start $ServiceName
Write-Ok "Service '$ServiceName' running on port $BackendPort"

# --- IIS site ---------------------------------------------------------------

Write-Step "Creating/updating IIS site '$SiteName'"
Import-Module WebAdministration

# Bound to "*" (all interfaces) explicitly -- some IIS setups default a new
# site to the machine's primary IP instead of wildcard when -IPAddress is
# left unspecified, which then rejects localhost/127.0.0.1 requests with a
# confusing "400 - Invalid Hostname" (the binding's IP doesn't match the
# interface the request came in on).
$desiredBinding = "*:${FrontendPort}:"
$clientDist = Join-Path $RepoRoot 'client\dist'
if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
    New-Website -Name $SiteName -PhysicalPath $clientDist -Port $FrontendPort -IPAddress '*' | Out-Null
    Write-Ok "Site created"
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $clientDist
    $binding = Get-WebBinding -Name $SiteName | Select-Object -First 1
    if (-not $binding -or $binding.bindingInformation -ne $desiredBinding) {
        Get-WebBinding -Name $SiteName | Remove-WebBinding
        New-WebBinding -Name $SiteName -IPAddress '*' -Port $FrontendPort -Protocol http
    }
    Write-Ok "Site already existed  -  path/binding updated"
}

try {
    Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter 'system.webServer/proxy' -name 'enabled' -value 'True'
    Write-Ok "ARR proxying enabled at the server level"
} catch {
    Write-Warn2 "Could not enable ARR proxying automatically ($($_.Exception.Message))  -  if ARR is installed, enable 'Enable proxy' in IIS Manager > server node > Application Request Routing Cache > Server Proxy Settings."
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue

# --- Health check -----------------------------------------------------------

Write-Step "Health check"
Start-Sleep -Seconds 2
try {
    $backend = Invoke-WebRequest -UseBasicParsing "http://localhost:$BackendPort/api/health" -TimeoutSec 10
    Write-Ok "Backend: HTTP $($backend.StatusCode)"
} catch {
    Write-Warn2 "Backend health check failed: $($_.Exception.Message)  -  check $serverDir\logs\service-err.log"
}
try {
    $frontend = Invoke-WebRequest -UseBasicParsing "http://localhost:$FrontendPort" -TimeoutSec 10
    Write-Ok "Frontend: HTTP $($frontend.StatusCode)"
} catch {
    Write-Warn2 "Frontend health check failed: $($_.Exception.Message)  -  check IIS logs / the URL Rewrite & ARR prerequisites above."
}

Write-Host "`nDone. Portal: http://localhost:$FrontendPort (or this server's hostname/IP from another machine, firewall/GPO permitting)." -ForegroundColor Green
