@echo off
title Launcher EXE Build
echo.
echo ============================================
echo   Launcher EXE Build
echo ============================================
echo.

cd /d "%~dp0"
node tools\build-setup-exe.mjs

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
echo ============================================
echo   BUILD COMPLETE - Launcher build finished
echo ============================================
echo.
pause
