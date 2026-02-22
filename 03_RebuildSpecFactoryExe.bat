@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"
echo Rebuilding full SpecFactory.exe...
call npm run gui:exe

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Full EXE rebuild failed.
  pause
  exit /b 1
)

echo.
echo Full EXE rebuild complete.
pause
