@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if /I "%~1"=="--quick" goto :quick
if /I "%~1"=="quick" goto :quick
if /I "%~1"=="--gui-only" goto :quick
if /I "%~1"=="gui-only" goto :quick
if /I "%~1"=="--help" goto :show_help
if /I "%~1"=="-h" goto :show_help
if /I "%~1"=="/?" goto :show_help

cd /d "%ROOT%"
echo Rebuilding full SpecFactory.exe...
call npm run gui:exe

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ============================================
    echo   BUILD FAILED - see errors above
    echo ============================================
    echo.
    pause
    exit /b 1
)

echo.
echo Full EXE rebuild complete.
echo.
goto :done

:quick
echo Quick GUI rebuild for existing SpecFactory.exe.
cd /d "%ROOT%"
call npm run gui:build
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo GUI build failed.
  pause
  exit /b 1
)

if exist "%ROOT%gui-dist" rmdir /s /q "%ROOT%gui-dist"
robocopy "%ROOT%tools\\gui-react\\dist" "%ROOT%gui-dist" /MIR /NFL /NDL /NJH /NJS /nc /ns /np
echo.
echo GUI assets synced to gui-dist.
echo Restart SpecFactory.exe to load updated assets.
goto :done

:show_help
echo.
echo Usage: 03_RebuildSpecFactoryExe.bat [--quick]
echo.
echo   (no arg)    full EXE rebuild (gui + pkg)
echo   --quick     gui build only + sync gui-dist
goto :done

:done
pause
