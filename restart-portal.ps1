# Restarts the CWT Tax Exposure Portal's local stack: PostgreSQL, then the
# server and client dev processes. Safe to double-click (or "Run with
# PowerShell") any time the portal stops responding after this machine
# sleeps/restarts, since none of these three processes are set up to
# auto-start on their own.
#
# Usage: right-click this file -> "Run with PowerShell", or from a terminal:
#   powershell -ExecutionPolicy Bypass -File restart-portal.ps1

$ErrorActionPreference = 'Stop'

$Node = 'C:\Users\villegaskmp\portable-dev\node-v24.18.0-win-x64'
$Pg = 'C:\Users\villegaskmp\portable-dev\pgsql'
$PgData = 'C:\Users\villegaskmp\portable-dev\pgdata'
$PgLog = 'C:\Users\villegaskmp\portable-dev\pg.log'
$RepoRoot = 'C:\Users\villegaskmp\Desktop\cwt-tax-portal'

Write-Host 'Starting PostgreSQL...'
& "$Pg\bin\pg_ctl.exe" -D $PgData -l $PgLog start
Start-Sleep -Seconds 2

$pgUp = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $pgUp) {
    Write-Host 'PostgreSQL did not come up — check' $PgLog -ForegroundColor Red
    exit 1
}
Write-Host 'PostgreSQL is up.' -ForegroundColor Green

$env:Path = "$Node;$env:Path"

Write-Host 'Starting server (port 4100)...'
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "cd '$RepoRoot\server'; `$env:Path = '$Node;' + `$env:Path; node node_modules/tsx/dist/cli.mjs watch src/index.ts"
)

Write-Host 'Starting client (port 5173)...'
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "cd '$RepoRoot\client'; `$env:Path = '$Node;' + `$env:Path; node node_modules/vite/bin/vite.js"
)

Write-Host ''
Write-Host 'Two new PowerShell windows opened for the server and client — leave them running.' -ForegroundColor Yellow
Write-Host 'Portal: http://localhost:5173  (login: cwtportal / taxteam2026!)' -ForegroundColor Green
