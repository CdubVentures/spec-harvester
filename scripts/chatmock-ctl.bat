@echo off
setlocal enabledelayedexpansion

set "CHATMOCK_DIR=%CHATMOCK_DIR%"
if "%CHATMOCK_DIR%"=="" set "CHATMOCK_DIR=C:\Users\Chris\Desktop\ChatMock"

set "COMPOSE_FILE=%CHATMOCK_COMPOSE_FILE%"
if "%COMPOSE_FILE%"=="" set "COMPOSE_FILE=%CHATMOCK_DIR%\docker-compose.yml"

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=status"

if /I "%ACTION%"=="start" (
  docker compose -f "%COMPOSE_FILE%" up -d
  exit /b %ERRORLEVEL%
)

if /I "%ACTION%"=="stop" (
  docker compose -f "%COMPOSE_FILE%" down
  exit /b %ERRORLEVEL%
)

if /I "%ACTION%"=="restart" (
  docker compose -f "%COMPOSE_FILE%" down
  if errorlevel 1 exit /b %ERRORLEVEL%
  docker compose -f "%COMPOSE_FILE%" up -d
  exit /b %ERRORLEVEL%
)

if /I "%ACTION%"=="rebuild" (
  docker compose -f "%COMPOSE_FILE%" up -d --build
  exit /b %ERRORLEVEL%
)

if /I "%ACTION%"=="logs" (
  docker compose -f "%COMPOSE_FILE%" logs --tail=200
  exit /b %ERRORLEVEL%
)

docker compose -f "%COMPOSE_FILE%" ps
exit /b %ERRORLEVEL%
