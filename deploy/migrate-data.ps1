# Run on THIS DEV LAPTOP (not the server). Copies everything that makes the
# dev environment's data what it is over to the IIS server, so both sides
# have the same contracts/ledgers/CTS files/database:
#   1. pg_dumps the dev laptop's local PostgreSQL database
#   2. mirrors the DATA_SYNC_DIR/ZONAL_VALUES_DIR folder (the "CWT ledger_reference"
#      source-of-truth folder) to the server
#   3. mirrors server\uploads (customer ledgers / CTS files uploaded through
#      the portal) to the server
#
# It does NOT restore the dump into the server's Postgres for you (that
# needs the server's own DB credentials, which this script has no reason to
# know) — it copies the .dump file over and prints the exact pg_restore
# command to run ON the server afterward.
#
# Usage (run from the repo root on this laptop):
#   powershell -ExecutionPolicy Bypass -File deploy\migrate-data.ps1 -ServerHost <server-hostname-or-ip>
#
# Requires: an admin share (\\<ServerHost>\c$) reachable from this laptop, or
# pass -DestRoot with a UNC path/mapped drive you already have write access to.

param(
    [Parameter(Mandatory = $true)]
    [string]$ServerHost,

    [string]$DestRoot = "\\$ServerHost\c`$\cwt-tax-portal",

    [string]$PgDumpExe = 'C:\Users\villegaskmp\portable-dev\pgsql\bin\pg_dump.exe',
    [string]$SourceDbHost = 'localhost',
    [string]$SourceDbPort = '5432',
    [string]$SourceDbUser = 'postgres',
    [string]$SourceDbName = 'cwt_tax_portal'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

# --- Read DATA_SYNC_DIR / ZONAL_VALUES_DIR straight from server\.env, so the
# path is never duplicated/hardcoded here and can't drift out of sync. ---

$envFile = Join-Path $RepoRoot 'server\.env'
if (-not (Test-Path $envFile)) { throw "server\.env not found at $envFile" }
$envLines = Get-Content $envFile
function Get-EnvValue($name) {
    $line = $envLines | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}
$dataSyncDir = Get-EnvValue 'DATA_SYNC_DIR'
if (-not $dataSyncDir) { throw "DATA_SYNC_DIR not set in $envFile" }
Write-Ok "DATA_SYNC_DIR = $dataSyncDir"
$zonalValuesDir = Get-EnvValue 'ZONAL_VALUES_DIR'
$zonalValuesDirDiffers = $zonalValuesDir -and ($zonalValuesDir -ne $dataSyncDir)
if ($zonalValuesDirDiffers) { Write-Ok "ZONAL_VALUES_DIR = $zonalValuesDir (different folder — will mirror separately)" }

if (-not (Test-Path $DestRoot)) {
    throw "Can't reach '$DestRoot' from this laptop — confirm the server hostname/IP, that its C`$ admin share is reachable on this network, and that your account has write access. Or pass -DestRoot with a path you do have access to."
}

# --- 1. Dump the database ---------------------------------------------------

Write-Step "Dumping database '$SourceDbName' from $SourceDbHost`:$SourceDbPort"
if (-not (Test-Path $PgDumpExe)) { throw "pg_dump.exe not found at $PgDumpExe — pass -PgDumpExe <path>." }

$outputDir = Join-Path $PSScriptRoot '_migration-output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$dumpFile = Join-Path $outputDir "cwt_tax_portal_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"

# -Fc = custom format, needed for pg_restore. Prompts for the DB password
# interactively if the local Postgres isn't set up for trust auth.
& $PgDumpExe -h $SourceDbHost -p $SourceDbPort -U $SourceDbUser -Fc -f $dumpFile $SourceDbName
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Write-Ok "Dumped to $dumpFile ($([math]::Round((Get-Item $dumpFile).Length / 1MB, 1)) MB)"

# --- 2. Mirror the data folder ---------------------------------------------

Write-Step "Mirroring '$dataSyncDir' -> $DestRoot\data\CWT ledger_reference"
$destData = Join-Path $DestRoot 'data\CWT ledger_reference'
New-Item -ItemType Directory -Force -Path $destData | Out-Null
robocopy $dataSyncDir $destData /MIR /R:2 /W:5 /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy of the data folder failed (exit code $LASTEXITCODE)" }
Write-Ok "Data folder mirrored"

if ($zonalValuesDirDiffers) {
    Write-Step "Mirroring '$zonalValuesDir' -> $DestRoot\data\Zonal Values"
    $destZonal = Join-Path $DestRoot 'data\Zonal Values'
    New-Item -ItemType Directory -Force -Path $destZonal | Out-Null
    robocopy $zonalValuesDir $destZonal /MIR /R:2 /W:5 /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { throw "robocopy of the zonal values folder failed (exit code $LASTEXITCODE)" }
    Write-Ok "Zonal values folder mirrored"
}

# --- 3. Mirror uploaded files -----------------------------------------------

$uploadsDir = Join-Path $RepoRoot 'server\uploads'
if (Test-Path $uploadsDir) {
    Write-Step "Mirroring server\uploads -> $DestRoot\server\uploads"
    $destUploads = Join-Path $DestRoot 'server\uploads'
    New-Item -ItemType Directory -Force -Path $destUploads | Out-Null
    robocopy $uploadsDir $destUploads /MIR /R:2 /W:5 /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { throw "robocopy of uploads failed (exit code $LASTEXITCODE)" }
    Write-Ok "Uploads mirrored"
} else {
    Write-Ok "No server\uploads folder yet on this laptop — nothing to copy"
}

# --- 4. Copy the dump over, print restore instructions ----------------------

Write-Step "Copying the dump file to the server"
$destMigration = Join-Path $DestRoot 'migration'
New-Item -ItemType Directory -Force -Path $destMigration | Out-Null
Copy-Item $dumpFile $destMigration
$destDumpName = Split-Path -Leaf $dumpFile
Write-Ok "Copied to $destMigration\$destDumpName"

Write-Host "`nData copied. Two things left to do ON THE SERVER:" -ForegroundColor Yellow
Write-Host "  1. Restore the database (fill in the server's own DB connection details):"
Write-Host "     pg_restore --clean --if-exists -h <host> -p <port> -U <user> -d $SourceDbName ""C:\cwt-tax-portal\migration\$destDumpName""" -ForegroundColor White
Write-Host "  2. In server\.env, set:"
Write-Host "     DATA_SYNC_DIR=C:/cwt-tax-portal/data/CWT ledger_reference" -ForegroundColor White
if ($zonalValuesDirDiffers) {
    Write-Host "     ZONAL_VALUES_DIR=C:/cwt-tax-portal/data/Zonal Values" -ForegroundColor White
} else {
    Write-Host "     ZONAL_VALUES_DIR=C:/cwt-tax-portal/data/CWT ledger_reference" -ForegroundColor White
}
Write-Host "  (see server\.env.production.example for the rest of what server\.env needs)" -ForegroundColor Yellow
