# One-time sign-in for the ONETT Summary's automatic page reading.
#
# The portal reads scanned ONETT pages by running the Claude Code program that
# ships with the Claude desktop app, using whatever Claude account it is signed
# in with. Run this once on the machine that hosts the portal's server; it opens
# a browser tab to sign in. Afterwards uploads on the ONETT Summary page are read
# automatically.
#
#   powershell -ExecutionPolicy Bypass -File server\scripts\claude-signin.ps1

$exe = $null
$copy = Join-Path $env:USERPROFILE 'claude-cli\claude.exe'
if (Test-Path $copy) {
    $exe = Get-Item $copy
} else {
    $root = Join-Path $env:APPDATA 'Claude\claude-code'
    $exe = Get-ChildItem $root -Recurse -Filter claude.exe -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Directory.Parent.Name) } -Descending |
        Select-Object -First 1
}

if (-not $exe) {
    Write-Host "Claude Code was not found (looked for $copy and under the Claude desktop app's folder)." -ForegroundColor Red
    exit 1
}

Write-Host "Using $($exe.FullName)"
& $exe.FullName auth status
Write-Host ""
Write-Host "Signing in (a browser window will open)..."
& $exe.FullName auth login
Write-Host ""
& $exe.FullName auth status
