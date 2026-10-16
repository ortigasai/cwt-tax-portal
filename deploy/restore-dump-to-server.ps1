# Restores a dump made by migrate-data.ps1 (or pg_dump -Fc) into the server's
# PostgreSQL, from any machine that can reach it over the network. It asks for the
# database password; nothing secret is stored in this file.
#
#   powershell -ExecutionPolicy Bypass -File deploy\restore-dump-to-server.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\restore-dump-to-server.ps1 -DumpFile <path> -DbHost <ip> -DbName <name>
#
# WARNING: --clean drops the existing tables in the target database and replaces
# them with the dump's. Back the server database up first if anyone has been
# entering data there.

param(
    [string]$DumpFile = '',
    [string]$DbHost = '192.168.0.215',
    [int]$DbPort = 5432,
    [string]$DbUser = 'postgres',
    [string]$DbName = 'cwt-tax-portal',
    [string]$PgRestoreExe = ''
)

$ErrorActionPreference = 'Stop'

if (-not $PgRestoreExe) {
    $candidates = @(
        'C:\Users\villegaskmp\portable-dev\pgsql\bin\pg_restore.exe'
    ) + (Get-ChildItem 'C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL' -Recurse -Filter pg_restore.exe -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
    $PgRestoreExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $PgRestoreExe) { throw 'pg_restore.exe not found - pass -PgRestoreExe <path>.' }

if (-not $DumpFile) {
    $dir = Join-Path $PSScriptRoot '_migration-output'
    $latest = Get-ChildItem $dir -Filter 'cwt_tax_portal_*.dump' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "No cwt_tax_portal_*.dump found in $dir - pass -DumpFile <path>." }
    $DumpFile = $latest.FullName
}
if (-not (Test-Path $DumpFile)) { throw "Dump file not found: $DumpFile" }

Write-Host "pg_restore : $PgRestoreExe"
Write-Host "dump       : $DumpFile"
Write-Host "target     : $DbUser@${DbHost}:$DbPort/$DbName"
Write-Host ""
Write-Host "This REPLACES the tables in '$DbName' on $DbHost with the dump's." -ForegroundColor Yellow
$answer = Read-Host "Type YES to continue"
if ($answer -ne 'YES') { Write-Host 'Cancelled.'; exit 1 }

& $PgRestoreExe --clean --if-exists --no-owner --no-privileges -h $DbHost -p $DbPort -U $DbUser -W -d $DbName $DumpFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "pg_restore finished with exit code $LASTEXITCODE (some warnings are normal on --clean; check the messages above)." -ForegroundColor Yellow
} else {
    Write-Host 'Restore complete.' -ForegroundColor Green
}
