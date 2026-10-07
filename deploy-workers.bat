@echo off
rem Deploys two Cloudflare Workers (proxy-terminal-1, proxy-terminal-2) and prints their URLs.
rem Needs Node. The first run opens a browser tab for `wrangler login`.
cd /d "%~dp0worker"
call npx --yes wrangler whoami 2>nul | findstr /i "not authenticated" >nul && call npx --yes wrangler login
for %%N in (1 2) do (
  echo.
  echo === Deploying proxy-terminal-%%N ===
  call npx --yes wrangler deploy --name proxy-terminal-%%N
)
echo.
echo Put the two https://proxy-terminal-N.<subdomain>.workers.dev URLs, with /api/v1 appended, into config.local.json
echo (see config.local.example.json), next to the matching OpenRouter API keys.
pause
