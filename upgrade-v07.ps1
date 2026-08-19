$ErrorActionPreference = "Stop"
Write-Host "CrakHost Control v0.7 major upgrade" -ForegroundColor Cyan
if (!(Test-Path ".env")) { throw ".env not found. Copy your v0.6 .env into this folder first." }
Copy-Item ".env" "apps\panel\.env.local" -Force
Write-Host "Starting PostgreSQL, Redis and CrakNode..." -ForegroundColor Yellow
docker compose up -d postgres redis craknode
Write-Host "Waiting for PostgreSQL..." -ForegroundColor Yellow
for ($i=0; $i -lt 30; $i++) { docker compose exec -T postgres pg_isready -U crakhost -d crakhost *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 2 }
Write-Host "Applying v0.7 database migration..." -ForegroundColor Yellow
Get-Content ".\database\migrations\v0.7.sql" -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }
Write-Host "v0.7 migration complete." -ForegroundColor Green
Write-Host "Next: npm install; npm run dev" -ForegroundColor Cyan
Write-Host "Scheduler/lifecycle worker: npm run worker" -ForegroundColor Cyan
