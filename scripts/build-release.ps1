$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$publisherRoot = Join-Path $projectRoot "services\publisher"
$venvPython = Join-Path $publisherRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    py -3.10 -m venv (Join-Path $publisherRoot ".venv")
}

& $venvPython -m pip install -e "$publisherRoot[dev,live]" -c (Join-Path $publisherRoot "constraints-live.txt")
if ($LASTEXITCODE -ne 0) { throw "Publisher dependency installation failed" }
& (Join-Path $PSScriptRoot "ensure-biliup.ps1")
& (Join-Path $PSScriptRoot "build-sidecar.ps1")
& (Join-Path $PSScriptRoot "smoke-sidecar.ps1")
& (Join-Path $PSScriptRoot "smoke-publisher.ps1") -MinimalPath
& (Join-Path $PSScriptRoot "generate-icon.ps1")

Push-Location $projectRoot
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    $electronExecutable = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path -LiteralPath $electronExecutable)) {
        $electronInstallScript = Join-Path $projectRoot "node_modules\electron\install.js"
        $hadElectronMirror = Test-Path Env:ELECTRON_MIRROR
        $previousElectronMirror = $env:ELECTRON_MIRROR
        try {
            if (-not $hadElectronMirror) {
                $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
            }
            node $electronInstallScript
            if ($LASTEXITCODE -ne 0) { throw "Electron runtime installation failed" }
        }
        finally {
            if ($hadElectronMirror) {
                $env:ELECTRON_MIRROR = $previousElectronMirror
            }
            else {
                Remove-Item Env:ELECTRON_MIRROR -ErrorAction SilentlyContinue
            }
        }
    }
    if (-not (Test-Path -LiteralPath $electronExecutable)) {
        throw "Electron runtime is missing after dependency installation"
    }
    npm.cmd run package:win --workspace @reviewflow/desktop
    if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed" }
}
finally {
    Pop-Location
}
