param([string]$RailwayPath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $RailwayPath) {
    $RailwayPath = Join-Path $projectRoot '.local-data/railway-tools/node_modules/.bin/railway.cmd'
}
$targets = Get-Content -LiteralPath (Join-Path $projectRoot 'infra/railway/targets.json') -Raw | ConvertFrom-Json

function Read-RailwayJson([string[]]$Arguments) {
    $result = & $RailwayPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Railway command failed. Check CLI login and project link.' }
    return ($result | ConvertFrom-Json)
}

# Read only: do not link, create, deploy, or print service variable values.
Push-Location $projectRoot
try {
    $status = Read-RailwayJson @('status', '--json')
    if ($status.id -ne $targets.projectId) { throw 'Linked Railway project differs from targets.json.' }
    $rows = foreach ($environment in $targets.environments.PSObject.Properties) {
        $found = @($status.environments.edges | Where-Object { $_.node.id -eq $environment.Value -and $_.node.name -eq $environment.Name })
        if ($found.Count -ne 1) { throw "Environment missing or renamed: $($environment.Name)" }
        $config = Read-RailwayJson @('environment', 'config', '--environment', $environment.Value, '--json')
        foreach ($service in $targets.services.PSObject.Properties) {
            $entry = $config.services.PSObject.Properties[$service.Value]
            if (-not $entry) { throw "Service missing: $($environment.Name)/$($service.Name)" }
            $regions = @($entry.Value.deploy.multiRegionConfig.PSObject.Properties)
            $matches = $regions.Count -eq 1 -and $regions[0].Name -eq $targets.region -and $regions[0].Value.numReplicas -eq 1
            if (-not $matches) { throw "Unexpected region or replica count: $($environment.Name)/$($service.Name)" }
            [pscustomobject]@{
                Environment = $environment.Name
                Service = $service.Name
                Region = $regions[0].Name
                Replicas = $regions[0].Value.numReplicas
            }
        }
    }
    $rows | Format-Table -AutoSize
    Write-Output 'Configuration verified. This does not verify application readiness or deployment.'
} finally {
    Pop-Location
}
