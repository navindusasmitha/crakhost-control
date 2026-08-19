$ErrorActionPreference = "Stop"
Write-Host "CrakHost Control v0.12 infrastructure upgrade" -ForegroundColor Cyan
if (!(Test-Path ".env") -and (Test-Path ".env.example")) { Copy-Item ".env.example" ".env" }
Copy-Item ".env" "apps\panel\.env.local" -Force
Write-Host "Removing stale demo container if present (persistent data volume is preserved)..." -ForegroundColor Yellow
$existing = docker ps -aq --filter "name=^/crakhost-minecraft-production$"
if ($existing) { docker rm -f crakhost-minecraft-production | Out-Null }
Write-Host "Starting core services..."
docker compose up -d postgres redis craknode
Write-Host "Waiting for PostgreSQL..."
for($i=0;$i -lt 30;$i++){ docker compose exec -T postgres pg_isready -U crakhost -d crakhost *> $null; if($LASTEXITCODE -eq 0){break}; Start-Sleep -Seconds 2 }
Write-Host "Applying v0.12 migration..."
Get-Content "database\migrations\v0.12.sql" -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
Write-Host "Recreating demo Minecraft container..."
docker compose --profile demo-game up -d minecraft-demo
Write-Host ""
Write-Host "v0.12 upgrade complete." -ForegroundColor Green
Write-Host "Next: npm install ; npm run dev"
Write-Host "Worker (second terminal): npm run worker"
Write-Host "Open: http://localhost:4310"
