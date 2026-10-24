@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Mail Manager
cd /d "%~dp0"

rem  NOTE: keep this file pure ASCII with CRLF line endings.
rem  Avoid multi-line ( ) blocks that contain echo text with parentheses;
rem  use goto / call :label instead (cmd parses whole blocks at once).

set "APP_VER=unknown"
if exist "VERSION" for /f "usebackq tokens=1" %%v in ("VERSION") do set "APP_VER=%%v"

echo ============================================
echo   Mail Manager v%APP_VER% - one-click start
echo   Folder : %CD%
echo   Usage  : start.bat [rebuild]
echo ============================================

rem ---- 0. Common mistake: zip extracted INTO an old copy, creating a nested folder ----
if exist "merged-mail-manager\start.bat" (
  echo [!] WARNING: found a nested "merged-mail-manager" folder inside this folder.
  echo [!] You may be starting an OLD copy. Run start.bat inside the newest folder instead.
  echo.
)

rem ---- 1. Node.js check, need 20+ ----
where node >nul 2>nul
if not errorlevel 1 goto node_found
echo [!] Node.js not found.
where winget >nul 2>nul
if errorlevel 1 goto node_manual
echo [*] Installing Node.js LTS via winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo [*] Done. Close this window and double-click start.bat again.
pause
exit /b 1
:node_manual
echo [*] Please install Node.js 20+ from https://nodejs.org then run again.
start "" https://nodejs.org/
pause
exit /b 1

:node_found
set "NODE_MAJOR=0"
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% GEQ 20 goto node_ok
echo [!] Node.js 20+ required, found:
node -v
pause
exit /b 1
:node_ok
for /f "delims=" %%a in ('node -v') do echo [OK] Node.js %%a

rem ---- 2. .env ----
if not exist ".env" copy /y ".env.example" ".env" >nul
if not exist ".env" goto env_missing
goto env_ok
:env_missing
echo [!] Could not create .env - is this folder read-only?
pause
exit /b 1
:env_ok

rem ---- 3. Port from .env, lines starting with # are comments ----
set "PORT=3000"
for /f "usebackq eol=# tokens=1,* delims== " %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set "PORT=%%b"
echo [OK] Port %PORT%

rem ---- 4. Dependencies ----
set "NEED_INSTALL=0"
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist "server\node_modules" set "NEED_INSTALL=1"
if not exist "web\node_modules" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="0" goto deps_ok
echo [*] Installing dependencies, first run takes a few minutes...
call npm run install:all
if not errorlevel 1 goto deps_ok
echo [*] Install failed with your current registry, retrying with npmmirror...
set "npm_config_registry=https://registry.npmmirror.com"
call npm run install:all
if not errorlevel 1 goto deps_ok
echo [*] Retrying with the official npm registry...
set "npm_config_registry=https://registry.npmjs.org"
call npm run install:all
if not errorlevel 1 goto deps_ok
echo [!] npm install failed. See the error above.
pause
exit /b 1
:deps_ok
echo [OK] Dependencies

rem ---- 5. Build frontend when missing, outdated, or "rebuild" requested ----
call :read_web_ver
set "NEED_BUILD=0"
if /i "%~1"=="rebuild" set "NEED_BUILD=1"
if not exist "web\dist\index.html" set "NEED_BUILD=1"
if not "%WEB_VER%"=="%APP_VER%" set "NEED_BUILD=1"
if "%NEED_BUILD%"=="0" goto build_ok
echo [*] Building frontend v%APP_VER%  - current build: %WEB_VER%
call npm run build
if not errorlevel 1 goto build_done
echo [!] Frontend build failed. See the error above.
pause
exit /b 1
:build_done
rem vite writes web\dist\.version itself; copy only as a fallback
if not exist "web\dist\.version" copy /y "VERSION" "web\dist\.version" >nul
call :read_web_ver
:build_ok
echo [OK] Frontend build v%WEB_VER%
if not "%WEB_VER%"=="%APP_VER%" echo [!] WARNING: frontend build v%WEB_VER% does not match app v%APP_VER%. Run: start.bat rebuild

rem ---- 6. Stop an old instance still holding the port ----
set "KILLED= "
set "PORT_BLOCKED=0"
for /f "tokens=1,2,3,5" %%a in ('netstat -ano') do call :check_listener %%a %%b %%c %%d
if "%PORT_BLOCKED%"=="1" goto port_blocked
goto port_ok
:port_blocked
echo [!] Port %PORT% is used by another program. Change PORT in .env and run again.
pause
exit /b 1
:port_ok
if not "%KILLED%"==" " ping -n 3 127.0.0.1 >nul

rem ---- 7. Open the browser once the server answers, then start the server ----
rem  A node helper in the background - no PowerShell window tricks, no hidden consoles.
start "" /b node "scripts\open-browser.cjs" %PORT%

echo.
echo ============================================
echo   App version     : v%APP_VER%
echo   Frontend build  : v%WEB_VER%
echo   URL             : http://localhost:%PORT%
echo   Stop            : Ctrl+C or close this window
echo ============================================
echo.
call npm start

echo.
echo [!] Server stopped.
pause
exit /b 0

rem ======================= subroutines =======================

:read_web_ver
set "WEB_VER=none"
if exist "web\dist\.version" for /f "usebackq tokens=1" %%v in ("web\dist\.version") do set "WEB_VER=%%v"
goto :eof

rem  args: proto, local address, foreign address, PID
rem  A listening socket always has foreign address 0.0.0.0:0 or [::]:0, independent of Windows language.
:check_listener
if /i not "%~1"=="TCP" goto :eof
if not "%~3"=="0.0.0.0:0" if not "%~3"=="[::]:0" goto :eof
echo %~2| findstr /e /c:":%PORT%" >nul
if errorlevel 1 goto :eof
call :stop_pid %~4
goto :eof

:stop_pid
rem  IPv4 and IPv6 rows can show the same PID - handle each PID only once
echo "%KILLED%" | findstr /c:" %~1 " >nul
if not errorlevel 1 goto :eof
set "KILLED=%KILLED%%~1 "
tasklist /fi "pid eq %~1" /fo csv /nh 2>nul | findstr /i /c:"node.exe" >nul
if not errorlevel 1 goto stop_pid_node
tasklist /fi "pid eq %~1" /fo csv /nh 2>nul | findstr /c:"%~1" >nul
if errorlevel 1 goto :eof
echo [!] Port %PORT% is held by PID %~1, which is not node.exe:
tasklist /fi "pid eq %~1" /nh
set "PORT_BLOCKED=1"
goto :eof
:stop_pid_node
echo [*] Old Mail Manager instance on port %PORT% - PID %~1 - stopping it...
taskkill /f /t /pid %~1 >nul 2>&1
goto :eof
