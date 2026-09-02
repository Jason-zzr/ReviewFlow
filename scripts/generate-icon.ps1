$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot "apps\desktop\buildResources"
$outputPath = Join-Path $outputDirectory "icon.png"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 512, 512
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#18211D"))

function Add-RoundedRectangle {
    param(
        [System.Drawing.Graphics]$Target,
        [System.Drawing.Brush]$Brush,
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    $Target.FillPath($Brush, $path)
    $path.Dispose()
}

$outlinePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#657068")), 12
$graphics.DrawRectangle($outlinePen, 84, 84, 344, 344)
$coralBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#EE6848"))
$yellowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#F1C95F"))
Add-RoundedRectangle $graphics $coralBrush 140 286 58 86 18
Add-RoundedRectangle $graphics $coralBrush 227 154 58 218 18
Add-RoundedRectangle $graphics $yellowBrush 314 220 58 152 18

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$yellowBrush.Dispose()
$coralBrush.Dispose()
$outlinePen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
Write-Output $outputPath
