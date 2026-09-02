$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$publisherRoot = Join-Path $projectRoot "services\publisher"
$cacheDirectory = Join-Path $publisherRoot ".wheel-cache"
$archivePath = Join-Path $cacheDirectory "biliupR-v1.2.4-x86_64-windows.zip"
$runtimeDirectory = Join-Path $publisherRoot "vendor-bin"
$runtimePath = Join-Path $runtimeDirectory "biliup.exe"
$assetUrl = "https://github.com/biliup/biliup/releases/download/v1.2.4/biliupR-v1.2.4-x86_64-windows.zip"
$expectedSha256 = "cb5af47aeaffd63719c94fa354a4d1404dd8437b6cc215513ec4e6054177c93e"

New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri $assetUrl -OutFile $archivePath
}

$archiveStream = [System.IO.File]::OpenRead($archivePath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $actualSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($archiveStream))).Replace("-", "").ToLowerInvariant()
}
finally {
    $sha256.Dispose()
    $archiveStream.Dispose()
}
if ($actualSha256 -ne $expectedSha256) {
    throw "Pinned biliup asset hash mismatch"
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$extractDirectory = Join-Path $temporaryRoot "reviewflow-biliup-$([guid]::NewGuid().ToString('N'))"
$resolvedExtractDirectory = [System.IO.Path]::GetFullPath($extractDirectory)
if (-not $resolvedExtractDirectory.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to extract outside the Windows temporary directory"
}
New-Item -ItemType Directory -Path $extractDirectory | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractDirectory)
    $candidate = Get-ChildItem -LiteralPath $extractDirectory -Recurse -File |
        Where-Object { $_.Name -in @("biliup.exe", "biliupr.exe") } |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Pinned biliup archive did not contain a supported executable"
    }
    Copy-Item -LiteralPath $candidate.FullName -Destination $runtimePath -Force
}
finally {
    Remove-Item -LiteralPath $extractDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output $runtimePath
