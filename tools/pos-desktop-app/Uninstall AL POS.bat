@echo off
rem Removes the AL POS icons (desktop, Start menu, start-up) from this computer.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'));" ^
  "foreach ($d in $dirs) { $p = Join-Path $d 'AL POS.lnk'; if (Test-Path $p) { Remove-Item $p; Write-Host ('Removed ' + $p) } };" ^
  "$i = Join-Path $env:LOCALAPPDATA 'AL POS'; if (Test-Path $i) { Remove-Item -Recurse $i };" ^
  "Write-Host 'AL POS removed.'"
echo.
pause
