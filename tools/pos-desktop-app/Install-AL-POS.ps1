# Installs the "AL POS" desktop app on this computer (Avi, 12 Oct 2026).
#
# Creates an "AL POS" icon on the desktop and in the Start menu that opens
# the POS in its own window - no tabs, no address bar - using the
# computer's Chrome (or Edge if Chrome isn't installed). It runs in the
# normal browser profile, so the existing POS login and printer settings
# carry over. Nothing else is installed; updates to the POS show up
# straight away. Run it via "Install AL POS.bat".

param(
  [string]$Url = 'http://170.64.231.166/pos',
  # Also open the POS automatically when Windows starts.
  [switch]$StartWithWindows,
  # Don't ask questions (for testing / scripted installs).
  [switch]$Quiet,
  [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
  [string]$StartMenuDir = [Environment]::GetFolderPath('Programs'),
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'AL POS')
)

$ErrorActionPreference = 'Stop'

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $browser) {
  Write-Host 'Neither Google Chrome nor Microsoft Edge was found on this computer.' -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$icon = Join-Path $InstallDir 'al-pos.ico'
Copy-Item -Force (Join-Path $PSScriptRoot 'al-pos.ico') $icon

$shell = New-Object -ComObject WScript.Shell
function New-PosShortcut([string]$folder) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $path = Join-Path $folder 'AL POS.lnk'
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $browser
  $lnk.Arguments = "--app=$Url --start-maximized"
  $lnk.WorkingDirectory = Split-Path $browser
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Australian Lighting & Fans - POS'
  $lnk.Save()
  return $path
}

$made = @(
  (New-PosShortcut $DesktopDir),
  (New-PosShortcut $StartMenuDir)
)

if (-not $StartWithWindows -and -not $Quiet) {
  $answer = Read-Host 'Open the POS automatically when this computer starts? (Y/N)'
  $StartWithWindows = $answer -match '^(y|yes)$'
}
if ($StartWithWindows) {
  $made += New-PosShortcut $StartupDir
}

Write-Host ''
Write-Host 'AL POS is installed.' -ForegroundColor Green
Write-Host "Opens with: $browser"
$made | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Tip: right-click the AL POS icon on the desktop and choose "Pin to taskbar".'
