$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot "services\publisher\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "Create services/publisher/.venv and install the dev extra first."
}
& $python (Join-Path $projectRoot "scripts\verify-publisher-deps.py")
if ($LASTEXITCODE -ne 0) {
    throw "Install services/publisher[dev,live] with constraints-live.txt before building."
}
Push-Location (Join-Path $projectRoot "services\publisher")
try {
    & $python -m PyInstaller --clean --noconfirm sidecar.spec
    if ($LASTEXITCODE -ne 0) { throw "reviewflow-sidecar.exe build failed" }
    & $python -m PyInstaller --clean --noconfirm sau.spec
    if ($LASTEXITCODE -ne 0) { throw "reviewflow-sau.exe build failed" }
    & (Join-Path $projectRoot "services\publisher\dist\reviewflow-sau.exe") --help | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "reviewflow-sau.exe smoke check failed" }
}
finally {
    Pop-Location
}
