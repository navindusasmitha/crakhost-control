$ErrorActionPreference="Stop"
Write-Host "CrakHost Control v0.13 production update" -ForegroundColor Cyan
if(!(Test-Path ".env")){Copy-Item ".env.example" ".env"};Copy-Item ".env" "apps\panel\.env.local" -Force
$old=docker ps -aq --filter "name=^/crakhost-minecraft-production$";if($old){docker rm -f crakhost-minecraft-production|Out-Null}
docker compose up -d postgres redis craknode
for($i=0;$i -lt 30;$i++){docker compose exec -T postgres pg_isready -U crakhost -d crakhost *> $null;if($LASTEXITCODE -eq 0){break};Start-Sleep 2}
Get-Content "database\migrations\v0.13.sql" -Raw|docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
Write-Host "v0.13 ready. npm install; npm run dev" -ForegroundColor Green
