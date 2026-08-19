$ErrorActionPreference = "Stop"
Write-Host "CrakHost Control v0.11 Infrastructure & Operations Upgrade" -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Reuse persistent volumes deliberately. Create if this is a fresh install.
$volumes = @(
  "crakhost-control-v04_pgdata",
  "crakhost-control-v04_minecraft_data",
  "crakhost-control-v04_craknode_backups"
)
foreach ($v in $volumes) {
  docker volume inspect $v *> $null
  if ($LASTEXITCODE -ne 0) { docker volume create $v | Out-Null }
}

Write-Host "Removing stale demo container if one exists..." -ForegroundColor Yellow
$old = docker ps -aq -f "name=^/crakhost-minecraft-production$"
if ($old) { docker rm -f $old | Out-Null }

Write-Host "Starting PostgreSQL, Redis and CrakNode v0.11..." -ForegroundColor Yellow
docker compose up -d postgres redis craknode

Write-Host "Waiting for PostgreSQL health..." -ForegroundColor Yellow
$ready = $false
for ($i=0; $i -lt 30; $i++) {
  docker compose exec -T postgres pg_isready -U crakhost -d crakhost *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "PostgreSQL did not become healthy." }

Write-Host "Applying v0.11 migration..." -ForegroundColor Yellow
Get-Content .\database\migrations\v0.11.sql -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
if ($LASTEXITCODE -ne 0) { throw "v0.11 database migration failed." }

if (Test-Path .\.env) { Copy-Item .\.env .\apps\panel\.env.local -Force }

Write-Host "Recreating demo Minecraft container with stable v0.11 settings..." -ForegroundColor Yellow
docker compose --profile demo-game up -d minecraft-demo

Write-Host ""; Write-Host "v0.11 upgrade complete." -ForegroundColor Green
Write-Host "Next: npm install ; npm run dev"
Write-Host "Worker: npm run worker (second PowerShell window)"
Write-Host "Operations: http://localhost:4310/operations"
