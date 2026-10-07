@echo off
setlocal
cd /d "%~dp0"
set URL=http://127.0.0.1:3100

rem Already running? Just open the browser.
curl -s -o nul %URL%/ && ( start "" %URL% & exit /b 0 )

rem Docker Desktop: start it if needed and wait up to 2 minutes
docker info >nul 2>&1
if errorlevel 1 (
  echo Starting Docker Desktop...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  for /l %%i in (1,1,60) do (
    docker info >nul 2>&1 && goto :docker_ok
    timeout /t 2 >nul
  )
  echo Docker did not start. Start Docker Desktop yourself and run this again.
  pause & exit /b 1
)
:docker_ok

rem cline-auto comes from your own install; it is copied into the image so the container runs the same logic
if not exist docker\cline-tools mkdir docker\cline-tools
for %%F in (cline_auto.py cline_models.py cline_log.py) do copy /y "%USERPROFILE%\cline-tools\%%F" docker\cline-tools\ >nul || ( echo Missing %USERPROFILE%\cline-tools\%%F & pause & exit /b 1 )

echo Building image (fast when cached)...
docker build -q -t proxy-terminal-cline docker || ( echo Docker build failed & pause & exit /b 1 )

if not exist config.local.json echo NOTE: no config.local.json yet, copy config.local.example.json and fill in your keys and Worker URLs.

start "" /b cmd /c "timeout /t 2 >nul & start "" %URL%"
node server.js
pause
