@echo off
setlocal EnableDelayedExpansion

for /f %%i in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"') do set "TS=%%i"

start "" "http://localhost:8788/?refresh=!TS!"

