param(
    [string]$Installer = "",
    [int]$StartupTimeoutSeconds = 20,
    [int]$ShutdownTimeoutSeconds = 12,
    [string]$WorkingDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Installer) {
    $Installer = Join-Path $projectRoot "apps\desktop\release\ReviewFlow-0.1.0-x64-setup.exe"
}
$resolvedInstaller = (Resolve-Path -LiteralPath $Installer).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\", "/")
$testRoot = if ($WorkingDirectory) {
    [System.IO.Path]::GetFullPath($WorkingDirectory)
}
else {
    [System.IO.Path]::GetFullPath(
        (Join-Path $temporaryRoot ("reviewflow-installed-smoke-" + [guid]::NewGuid().ToString("N")))
    )
}
$temporaryPrefix = $temporaryRoot + [System.IO.Path]::DirectorySeparatorChar
if (
    -not $testRoot.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path -Leaf $testRoot).StartsWith("reviewflow-installed-smoke-")
) {
    throw "Installer smoke directory must stay inside the system temporary directory"
}

$installRoot = Join-Path $testRoot "app"
$userDataRoot = Join-Path $testRoot "user-data"
$installedExecutable = Join-Path $installRoot "ReviewFlow.exe"
$installedSidecar = Join-Path $installRoot "resources\publisher\reviewflow-sidecar.exe"
$previousPath = $env:PATH
$hadLivePublishingOverride = Test-Path Env:REVIEWFLOW_LIVE_PUBLISH
$previousLivePublishingOverride = $env:REVIEWFLOW_LIVE_PUBLISH

function Get-ProcessesAtPath {
    param([string]$ExecutablePath)

    if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { return @() }
    $expectedPath = [System.IO.Path]::GetFullPath($ExecutablePath)
    $name = [System.IO.Path]::GetFileName($ExecutablePath).Replace("'", "''")
    return @(
        Get-CimInstance Win32_Process -Filter "Name='$name'" |
            Where-Object {
                $_.ExecutablePath -and
                [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals(
                    $expectedPath,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

function Stop-ProcessesAtPath {
    param([string]$ExecutablePath)

    foreach ($process in @(Get-ProcessesAtPath -ExecutablePath $ExecutablePath)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForNoProcessesAtPath {
    param(
        [string]$ExecutablePath,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-ProcessesAtPath -ExecutablePath $ExecutablePath).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return @(Get-ProcessesAtPath -ExecutablePath $ExecutablePath).Count -eq 0
}

function Get-ActiveUninstallers {
    param([string]$InstalledPath)

    return @(
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.Name -like "Un_*.exe" -and
                $_.CommandLine -and
                $_.CommandLine.Contains($InstalledPath)
            }
    )
}

function Wait-ForUninstallCompletion {
    param(
        [string]$InstalledPath,
        [string]$DesktopExecutable,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $desktopRemoved = -not (Test-Path -LiteralPath $DesktopExecutable -PathType Leaf)
        if ($desktopRemoved -and @(Get-ActiveUninstallers -InstalledPath $InstalledPath).Count -eq 0) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Start-AndWait {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$Operation
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(60000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$Operation timed out"
    }
    if ($process.ExitCode -ne 0) {
        throw "$Operation failed with exit code $($process.ExitCode)"
    }
}

try {
    if (-not (Test-Path -LiteralPath $testRoot)) {
        New-Item -ItemType Directory -Path $testRoot | Out-Null
    }
    Start-AndWait -FilePath $resolvedInstaller -ArgumentList @("/S", "/D=$installRoot") -Operation "Silent install"
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "Installed desktop executable is missing"
    }
    if (-not (Test-Path -LiteralPath $installedSidecar -PathType Leaf)) {
        throw "Installed Sidecar executable is missing"
    }

    $env:PATH = "C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem"
    Remove-Item Env:REVIEWFLOW_LIVE_PUBLISH -ErrorAction SilentlyContinue
    $desktop = Start-Process `
        -FilePath $installedExecutable `
        -ArgumentList @("--user-data-dir=$userDataRoot") `
        -PassThru `
        -WindowStyle Hidden

    $desktopReady = $false
    $sidecarReady = $false
    $startupDeadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $startupDeadline) {
        $desktop.Refresh()
        $desktopReady = -not $desktop.HasExited
        $sidecarReady = @(Get-ProcessesAtPath -ExecutablePath $installedSidecar).Count -gt 0
        if ($desktopReady -and $sidecarReady) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $desktopReady) { throw "Installed desktop did not remain running" }
    if (-not $sidecarReady) { throw "Installed Sidecar did not start without system Python on PATH" }

    $publisherSettings = Join-Path $userDataRoot "publisher-settings.json"
    if (Test-Path -LiteralPath $publisherSettings -PathType Leaf) {
        $settings = Get-Content -LiteralPath $publisherSettings -Raw | ConvertFrom-Json
        if ($settings.enabled -eq $true) { throw "Real publishing must be disabled in clean user data" }
    }

    Stop-ProcessesAtPath -ExecutablePath $installedExecutable
    if (-not (Wait-ForNoProcessesAtPath -ExecutablePath $installedExecutable -TimeoutSeconds $ShutdownTimeoutSeconds)) {
        throw "Installed desktop processes remained after forced shutdown"
    }
    if (-not (Wait-ForNoProcessesAtPath -ExecutablePath $installedSidecar -TimeoutSeconds $ShutdownTimeoutSeconds)) {
        throw "Installed Sidecar remained after its Electron parent exited"
    }

    $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter "Uninstall*.exe" -File)
    if ($uninstallers.Count -ne 1) { throw "Expected one installed uninstaller; found $($uninstallers.Count)" }
    Start-AndWait -FilePath $uninstallers[0].FullName -ArgumentList @("/S") -Operation "Silent uninstall"
    if (-not (Wait-ForUninstallCompletion -InstalledPath $installRoot -DesktopExecutable $installedExecutable -TimeoutSeconds 20)) {
        throw "Silent uninstall did not finish removing the desktop executable"
    }

    [pscustomobject]@{
        installer = "ready"
        systemPythonRequired = $false
        realPublishingDefault = "disabled"
        parentWatchdog = "passed"
        uninstalled = $true
    } | ConvertTo-Json -Compress
}
finally {
    Stop-ProcessesAtPath -ExecutablePath $installedExecutable
    Stop-ProcessesAtPath -ExecutablePath $installedSidecar
    Wait-ForNoProcessesAtPath -ExecutablePath $installedExecutable -TimeoutSeconds 5 | Out-Null
    Wait-ForNoProcessesAtPath -ExecutablePath $installedSidecar -TimeoutSeconds 5 | Out-Null
    $env:PATH = $previousPath
    if ($hadLivePublishingOverride) {
        $env:REVIEWFLOW_LIVE_PUBLISH = $previousLivePublishingOverride
    }
    else {
        Remove-Item Env:REVIEWFLOW_LIVE_PUBLISH -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $installRoot) {
        $activeUninstallers = @(Get-ActiveUninstallers -InstalledPath $installRoot)
        if ($activeUninstallers.Count -eq 0) {
            $cleanupUninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter "Uninstall*.exe" -File)
            if ($cleanupUninstallers.Count -eq 1) {
                Start-AndWait -FilePath $cleanupUninstallers[0].FullName -ArgumentList @("/S") -Operation "Cleanup uninstall"
            }
        }
        Wait-ForUninstallCompletion -InstalledPath $installRoot -DesktopExecutable $installedExecutable -TimeoutSeconds 20 | Out-Null
    }
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedCleanup = [System.IO.Path]::GetFullPath($testRoot)
        if (-not $resolvedCleanup.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean a directory outside the system temporary directory"
        }
        Remove-Item -LiteralPath $resolvedCleanup -Recurse -Force
    }
}
