@echo off
title Control de alquiler de maquinaria - Iniciar entorno
echo ============================================================
echo  Control de alquiler de maquinaria de construccion V2
echo  Se cierran los procesos viejos y se levanta todo limpio...
echo ============================================================
where pwsh >nul 2>&1
if %errorlevel% neq 0 goto SINPWSH
echo [1 de 2] Cerrando procesos viejos y liberando los puertos del sistema...
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\detener.ps1"
echo.
echo [2 de 2] Iniciando las 6 piezas (gateway, APIs, web y base de datos)...
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
echo.
echo Proceso terminado. Revise los mensajes de arriba.
pause
exit /b %errorlevel%
:SINPWSH
echo [ERROR] No se encontro pwsh PowerShell 7. Instalelo y reintente.
pause
exit /b 1
