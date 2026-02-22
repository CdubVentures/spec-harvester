@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"
echo Building GUI...
call npm run gui:build

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo GUI build failed.
  pause
  exit /b 1
)

echo.
echo GUI build complete.
pause

