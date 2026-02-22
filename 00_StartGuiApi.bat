@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo Starting SpecFactory API on http://localhost:8788
start "SpecFactory API (8788)" cmd /k "cd /d ""%ROOT%"" && npm run gui:api"

