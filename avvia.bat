@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Apri
echo.
echo Il server si e' fermato. Se vedi un errore qui sopra, copialo e mandamelo.
pause
