param(
    [string]$Executable = "",
    [string]$BiliupExecutable = "",
    [switch]$MinimalPath
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) {
    $Executable = Join-Path $projectRoot "services\publisher\dist\reviewflow-sau.exe"
}
if (-not $BiliupExecutable) {
    $BiliupExecutable = Join-Path $projectRoot "services\publisher\vendor-bin\biliup.exe"
}
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$resolvedBiliup = (Resolve-Path -LiteralPath $BiliupExecutable).Path
$smokeData = Join-Path ([System.IO.Path]::GetTempPath()) "reviewflow-publisher-smoke"
$previousDataDir = $env:REVIEWFLOW_PUBLISHER_DATA_DIR
$previousBiliup = $env:REVIEWFLOW_BILIUP_EXECUTABLE
$previousPath = $env:PATH

try {
    $env:REVIEWFLOW_PUBLISHER_DATA_DIR = $smokeData
    $env:REVIEWFLOW_BILIUP_EXECUTABLE = $resolvedBiliup
    if ($MinimalPath) {
        $env:PATH = "C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem"
    }

    & $resolvedExecutable doctor
    if ($LASTEXITCODE -ne 0) {
        throw "Publisher doctor failed with exit code $LASTEXITCODE"
    }

    foreach ($platform in @("xiaohongshu", "douyin", "bilibili")) {
        & $resolvedExecutable $platform check --account "package-smoke"
        if ($LASTEXITCODE -ne 20) {
            throw "$platform expected account_auth_required exit code 20; got $LASTEXITCODE"
        }
    }

    [pscustomobject]@{
        doctor = "ready"
        unauthenticatedPlatforms = 3
        systemPythonRequired = $false
    } | ConvertTo-Json -Compress
}
finally {
    $env:REVIEWFLOW_PUBLISHER_DATA_DIR = $previousDataDir
    $env:REVIEWFLOW_BILIUP_EXECUTABLE = $previousBiliup
    $env:PATH = $previousPath
}
