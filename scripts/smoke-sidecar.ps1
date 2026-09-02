param(
    [string]$Executable = "",
    [int]$Port = 43891
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) {
    $Executable = Join-Path $projectRoot "services\publisher\dist\reviewflow-sidecar.exe"
}
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$smokeData = Join-Path ([System.IO.Path]::GetTempPath()) "reviewflow-sidecar-smoke"

$env:REVIEWFLOW_SESSION_TOKEN = "packaged-smoke-session-token"
$env:REVIEWFLOW_SIDECAR_PORT = [string]$Port
$env:REVIEWFLOW_DATA_DIR = $smokeData
$sidecarProcess = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden

try {
    $health = $null
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
            break
        }
        catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $health -or $health.status -ne "ok") {
        throw "Packaged sidecar did not become healthy"
    }

    $unauthorizedStatus = 0
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/adapters" -TimeoutSec 2 | Out-Null
    }
    catch {
        $unauthorizedStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($unauthorizedStatus -ne 401) {
        throw "Expected unauthenticated adapter request to return 401; got $unauthorizedStatus"
    }

    [pscustomobject]@{
        healthy = $true
        version = $health.version
        unauthenticatedStatus = $unauthorizedStatus
    } | ConvertTo-Json -Compress
}
finally {
    Stop-Process -Id $sidecarProcess.Id -Force -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='reviewflow-sidecar.exe'" |
        Where-Object { $_.ExecutablePath -eq $resolvedExecutable } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
