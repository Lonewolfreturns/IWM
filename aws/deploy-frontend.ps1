# =============================================================================
# IWM — build and ship the frontend to EC2
# =============================================================================
#
#   .\aws\deploy-frontend.ps1
#   .\aws\deploy-frontend.ps1 -SkipBuild        # reuse the existing build
#
# Rebuilds, wipes the remote directory, copies the new build up, and fixes
# permissions. That last step is not optional: `scp -r` creates directories
# with the umask of the copy, and a mode-700 `assets/` directory means nginx
# can read a file but cannot enter the folder holding it — every script and
# stylesheet returns 403 while index.html serves happily, so the site is a
# blank white page with no obvious cause.
#
# The wipe matters too. Bundle filenames are content-hashed, so a plain copy
# leaves every previous build's assets behind: the directory grows forever and
# a half-finished upload can leave a mix of two builds being served.
# =============================================================================

param(
    [string]$KeyPath  = "$env:USERPROFILE\.ssh\iwm-key.pem",
    [string]$Target   = "ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com",
    [string]$RemoteDir = "/var/www/iwm",
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo  = Split-Path -Parent $PSScriptRoot
$front = Join-Path $repo 'frontend'
$build = Join-Path $front 'build'

if (-not (Test-Path $KeyPath)) {
    throw "Key not found at $KeyPath. Pass -KeyPath if it lives elsewhere."
}

# --- 1. Build -----------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host "==> Building" -ForegroundColor Cyan
    # VITE_* values are inlined into the bundle at build time, so the build
    # must happen here where frontend/.env exists — not on the server.
    Push-Location $front
    try { npm run build } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $build 'index.html'))) {
    throw "No build found at $build. Run without -SkipBuild."
}

$size = '{0:N1} MB' -f ((Get-ChildItem $build -Recurse -File |
    Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "==> Build ready ($size)" -ForegroundColor Cyan

# --- 2. Clear the old build --------------------------------------------
Write-Host "==> Clearing $RemoteDir" -ForegroundColor Cyan
ssh -i $KeyPath $Target "rm -rf $RemoteDir/*"
if ($LASTEXITCODE -ne 0) { throw "Could not clear the remote directory." }

# --- 3. Upload ----------------------------------------------------------
Write-Host "==> Uploading" -ForegroundColor Cyan
# The trailing \* copies the CONTENTS of build, so index.html lands at the
# root of $RemoteDir rather than inside a nested build/ folder.
scp -i $KeyPath -r "$build\*" "${Target}:$RemoteDir/"
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

# --- 4. Permissions -----------------------------------------------------
Write-Host "==> Fixing permissions" -ForegroundColor Cyan
# a+rX: read for everyone, execute ONLY on directories (capital X). Without
# the execute bit nginx cannot traverse assets/ and every bundle 403s.
ssh -i $KeyPath $Target "sudo chmod -R a+rX $RemoteDir && sudo chmod 755 /var/www"
if ($LASTEXITCODE -ne 0) { throw "Could not set permissions." }

# --- 5. Verify ----------------------------------------------------------
Write-Host "==> Verifying" -ForegroundColor Cyan
$hostName = ($Target -split '@')[-1]
$asset = (Select-String -Path (Join-Path $build 'index.html') `
    -Pattern '/assets/[A-Za-z0-9._-]+\.js').Matches[0].Value

$checks = @{
    'index.html' = "http://$hostName/"
    'deep link'  = "http://$hostName/login"
    'JS bundle'  = "http://$hostName$asset"
}

$failed = $false
foreach ($name in $checks.Keys) {
    try {
        $code = (Invoke-WebRequest -Uri $checks[$name] -Method Head `
            -TimeoutSec 15 -SkipHttpErrorCheck).StatusCode
    } catch { $code = 'unreachable' }

    if ($code -eq 200) {
        Write-Host ("    {0,-11} {1}" -f $name, $code) -ForegroundColor Green
    } else {
        $failed = $true
        Write-Host ("    {0,-11} {1}" -f $name, $code) -ForegroundColor Red
    }
}

if ($failed) {
    Write-Host "`nSomething is not serving. Check on the instance:" -ForegroundColor Yellow
    Write-Host "  sudo tail -20 /var/log/nginx/error.log"
    exit 1
}

Write-Host "`nDeployed: http://$hostName" -ForegroundColor Green
Write-Host "Hard-refresh (Ctrl+F5) to pick up the new bundle."
