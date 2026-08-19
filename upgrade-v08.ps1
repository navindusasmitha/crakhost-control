$ErrorActionPreference = "Stop"
Write-Host "CrakHost Control v0.8 major upgrade" -ForegroundColor Cyan
if (!(Test-Path ".env")) { throw "Missing .env. Copy it from v0.7 first." }
Copy-Item ".env" "apps\panel\.env.local" -Force
Write-Host "Starting PostgreSQL, Redis and CrakNode..." -ForegroundColor Yellow
docker compose up -d postgres redis craknode
Write-Host "Waiting for PostgreSQL health..." -ForegroundColor Yellow
$ok = $false
for ($i=0; $i -lt 20; $i++) {
  docker compose exec -T postgres pg_isready -U crakhost -d crakhost *> $null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 2
}
if (!$ok) { throw "PostgreSQL did not become ready." }
Write-Host "Applying v0.8 database migration..." -ForegroundColor Yellow
Get-Content ".\database\migrations\v0.8.sql" -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
if ($LASTEXITCODE -ne 0) { throw "v0.8 migration failed." }
Write-Host "v0.8 migration complete." -ForegroundColor Green
Write-Host "Next: npm install ; npm run dev" -ForegroundColor Cyan
Write-Host "Worker: npm run worker (second PowerShell window)" -ForegroundColor Cyan
