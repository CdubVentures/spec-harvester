@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "FOR_EXE=0"

if /I "%~1"=="--quick" set "FOR_EXE=1"
if /I "%~1"=="quick" set "FOR_EXE=1"
if /I "%~1"=="--for-exe" set "FOR_EXE=1"
if /I "%~1"=="for-exe" set "FOR_EXE=1"
if /I "%~1"=="--help" goto :show_help
if /I "%~1"=="-h" goto :show_help
if /I "%~1"=="/?" goto :show_help
if /I "%~1"=="help" goto :show_help

cd /d "%ROOT%"
echo Building GUI...
call npm run gui:build

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo GUI build failed.
  pause
  exit /b 1
)

if "%FOR_EXE%"=="1" (
  echo.
  echo Copying GUI assets to gui-dist for exe testing...
  if exist "%ROOT%gui-dist" rmdir /s /q "%ROOT%gui-dist"
  robocopy "%ROOT%tools\\gui-react\\dist" "%ROOT%gui-dist" /MIR /NFL /NDL /NJH /NJS /nc /ns /np
  echo.
  echo GUI build complete (gui-dist synchronized).
) else (
  echo.
  echo GUI build complete.
)
pause
goto :eof

:show_help
echo.
echo Usage: 01_BuildGui.bat [--quick]
echo.
echo   (no arg)    runs gui:build only
echo   --quick     runs gui:build + syncs tools/gui-react/dist -> gui-dist
pause
