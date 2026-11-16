@echo off
title DownMe Local Server
cd /d "%~dp0"
echo Starting DownMe server on http://localhost:3000 ...
start "" http://localhost:3000
uv run python run_app.py
pause
