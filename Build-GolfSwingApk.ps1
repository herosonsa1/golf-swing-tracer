# ============================================================================
# Build-GolfSwingApk.ps1
# Android APK Auto-Version Build & Root Deployment Script (나만의골프스윙_vX.Y.apk)
# ============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MobileDir = Join-Path $RootDir "mobile"
$AppPrefix = -join ([char[]]@(0xB098, 0xB9CC, 0xC758, 0xACE8, 0xD504, 0xC2A4, 0xC719))

function Rename-LegacyGolfSwingApks([string]$dirPath) {
    if (-not (Test-Path $dirPath)) { return }
    Get-ChildItem -Path (Join-Path $dirPath "GolfSwing_v*.apk") -ErrorAction SilentlyContinue | ForEach-Object {
        $verPart = $_.Name.Substring("GolfSwing_".Length)
        $newPath = Join-Path $dirPath ("{0}_{1}" -f $AppPrefix, $verPart)
        if (Test-Path $newPath) {
            Remove-Item -Path $_.FullName -Force
        } else {
            Move-Item -Path $_.FullName -Destination $newPath -Force
        }
    }
}

Rename-LegacyGolfSwingApks -dirPath $RootDir
Rename-LegacyGolfSwingApks -dirPath $MobileDir

if (Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe") {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ("[{0} APK Build] Syncing web assets and building versioned APK..." -f $AppPrefix) -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

Push-Location $MobileDir
try {
    & "$MobileDir\gradlew.bat" assembleDebug --console=plain
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle assembleDebug failed (ExitCode: $LASTEXITCODE)"
    }
} finally {
    Pop-Location
}

$LegacyDist = Join-Path $MobileDir "dist"
if (Test-Path $LegacyDist) {
    Remove-Item -Path $LegacyDist -Recurse -Force
}

Write-Host ""
Write-Host "[Project Root (.\) Versioned APK List]" -ForegroundColor Green
Get-ChildItem -Path (Join-Path $RootDir ("{0}_v*.apk" -f $AppPrefix)) | Sort-Object LastWriteTime | ForEach-Object {
    Write-Host ("  - {0} ({1:N0} Bytes, {2})" -f $_.Name, $_.Length, $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
}

Write-Host "[Mobile Root (mobile\.\) Versioned APK List]" -ForegroundColor Green
Get-ChildItem -Path (Join-Path $MobileDir ("{0}_v*.apk" -f $AppPrefix)) | Sort-Object LastWriteTime | ForEach-Object {
    Write-Host ("  - {0} ({1:N0} Bytes, {2})" -f $_.Name, $_.Length, $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
}
