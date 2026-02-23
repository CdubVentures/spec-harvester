@echo off
setlocal EnableDelayedExpansion

for /f %%i in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"') do set "TS=%%i"

set "URL=http://localhost:8788/?refresh=!TS!"
netstat -ano | findstr /R ":5173 " | findstr LISTENING >nul
if %ERRORLEVEL% EQU 0 set "URL=http://localhost:5173/?refresh=!TS!"

start "" "!URL!"
pause
