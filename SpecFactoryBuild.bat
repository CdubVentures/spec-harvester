@echo off
title SpecFactory Build
echo.
echo ============================================
echo   SpecFactory Full Build
echo ============================================
echo.
echo This will rebuild everything:
echo   1. React GUI
echo   2. Server bundle (launcher.cjs)
echo   3. SpecFactory.exe
echo   4. gui-dist/ assets
echo.

cd /d "%~dp0"
node tools/build-exe.mjs

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
echo   BUILD COMPLETE - ready to run
echo ============================================
echo.
pause
