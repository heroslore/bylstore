@echo off
REM Abre a Central de Inteligencia (agentes rodando neste PC).
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22 LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
if not exist agentes.env (copy agentes.env.exemplo agentes.env >nul & echo Preencha o arquivo agentes.env e rode de novo. & notepad agentes.env & exit /b 1)
start "" http://127.0.0.1:8787
node --env-file-if-exists=agentes.env agentes\servidor.js
pause
