$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$address = 'http://127.0.0.1:4180/health/ready'
try {
  $ready = Invoke-RestMethod -Uri $address -TimeoutSec 2
  if ($ready.mode -eq 'local-mvp') {
    Write-Output 'CRM is already running: http://127.0.0.1:4180/live'
    exit 0
  }
} catch {}
if (Get-NetTCPConnection -LocalPort 4180 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 4180 is occupied. Inspect the existing service before starting another CRM process.'
}
$nodePath = (Get-Command node.exe).Source
$dataPath = Join-Path $projectRoot '.local-data'
if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'access.txt'))) {
  throw 'Run pnpm live:setup once before starting the review server.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps/web/dist/index.html'))) {
  throw 'Run pnpm build before starting the review server.'
}
$process = Start-Process -FilePath $nodePath -ArgumentList 'apps/api/src/server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'live-server.out.log') -RedirectStandardError (Join-Path $dataPath 'live-server.err.log') -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $dataPath 'live-server.pid')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  if ($process.HasExited) { throw 'CRM process exited. Check .local-data/live-server.err.log.' }
  try {
    $ready = Invoke-RestMethod -Uri $address -TimeoutSec 2
    if ($ready.mode -eq 'local-mvp') {
      Write-Output 'CRM started in the background: http://127.0.0.1:4180/live'
      exit 0
    }
  } catch {}
}
throw 'CRM is still starting or failed. Check .local-data/live-server.err.log before retrying.'
