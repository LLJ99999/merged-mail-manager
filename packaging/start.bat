@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Mail Manager
cd /d "%~dp0"

rem  Portable launcher. Keep this file pure ASCII with CRLF line endings.
rem  Uses the bundled Node.js in node\ - no Node install needed.
rem  Data lives in the data\ folder next to this file.

set "APP_VER=unknown"
if exist "VERSION" for /f "usebackq tokens=1" %%v in ("VERSION") do set "APP_VER=%%v"

echo ============================================
echo   Mail Manager v%APP_VER% - portable
echo   Folder : %CD%
echo ============================================

if exist "node\node.exe" goto node_ok
echo [!] node\node.exe not found. Please extract the WHOLE zip again.
if not defined CI pause
exit /b 1
:node_ok

if not exist ".env" copy /y ".env.example" ".env" >nul
if exist ".env" goto env_ok
echo [!] Could not create .env - is this folder read-only?
if not defined CI pause
exit /b 1
:env_ok
if not exist "data" mkdir "data"

set "PORT_CFG=3000"
for /f "usebackq eol=# tokens=1,* delims== " %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set "PORT_CFG=%%b"
if defined PORT set "PORT_CFG=%PORT%"

echo [OK] Node.js bundled
echo [OK] Data folder : %CD%\data
echo [OK] Open http://localhost:%PORT_CFG%  - close this window or press Ctrl+C to stop
echo.

if not defined MM_NO_BROWSER start "" /b "node\node.exe" "scripts\open-browser.cjs" %PORT_CFG%

"node\node.exe" "server\dist\server.js"
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" exit /b 0
echo.
echo [!] Server stopped with error code %RC%. See the messages above.
echo [!] If the port is in use, change PORT in .env and start again.
if not defined CI pause
exit /b %RC%
