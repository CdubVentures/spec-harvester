@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "MODE=%~1"

if /I "%MODE%"=="--help" goto :show_help
if /I "%MODE%"=="-h" goto :show_help
if /I "%MODE%"=="/?" goto :show_help
if /I "%MODE%"=="help" goto :show_help
if /I "%MODE%"=="api" goto :start_api_only
if /I "%MODE%"=="api-only" goto :start_api_only
if /I "%MODE%"=="backend" goto :start_api_only
if /I "%MODE%"=="--api" goto :start_api_only
if /I "%MODE%"=="--api-only" goto :start_api_only
goto :start_stack

:start_stack
echo Starting SpecFactory GUI development stack.
echo   API:  http://localhost:8788
echo   GUI:  http://localhost:5173
echo.
start "SpecFactory API (8788)" cmd /k "cd /d ""%ROOT%"" && npm run gui:api"
start "SpecFactory GUI (5173)" cmd /k "cd /d ""%ROOT%\tools\gui-react"" && npm run dev"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
goto :eof

:start_api_only
echo Starting SpecFactory API on http://localhost:8788
start "SpecFactory API (8788)" cmd /k "cd /d ""%ROOT%"" && npm run gui:api"
start "" "http://localhost:8788"
goto :eof

:show_help
echo.
echo Usage: 00_StartGuiApi.bat [api-only]
echo.
echo   (no arg)    starts API + Vite GUI dev server
echo   api-only    starts API only
echo.
goto :eof
