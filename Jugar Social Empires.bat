@echo off
title Social Empires Forge (v1.4.07)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] El lanzador termino con un error. Revisa el mensaje anterior.
    pause
)
