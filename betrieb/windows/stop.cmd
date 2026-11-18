@echo off
rem Einsatzplaner stoppen (Windows). Liegt in C:\einsatzplaner\stop.cmd.
rem Beendet nur den Einsatzplaner (Port aus der Konfiguration, Standard 3010) und die Schleife in start.cmd.
setlocal EnableExtensions
set "EP_ROOT=%~dp0"
if "%EP_ROOT:~-1%"=="\" set "EP_ROOT=%EP_ROOT:~0,-1%"
set "ENV_FILE=%EP_ROOT%\einsatzplaner.env"
set "PORT_EP=3010"
if exist "%ENV_FILE%" for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do if /i "%%a"=="PORT" set "PORT_EP=%%b"

rem 1. Stopp-Datei anlegen. Node beendet sich sauber, die Schleife endet.
echo stop> "%EP_ROOT%\stop.flag"

rem 2. Bis 20 Sekunden warten, bis der Port frei ist.
for /l %%i in (1,1,20) do (
  netstat -ano -p tcp | findstr /r /c:":%PORT_EP% .*LISTENING" >nul || goto frei
  ping -n 2 127.0.0.1 >nul
)

rem 3. Notfall: nur den Node-Prozess auf diesem Port beenden.
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT_EP% .*LISTENING"') do (
  tasklist /fi "PID eq %%p" | find /i "node.exe" >nul && taskkill /pid %%p /f >nul
)

:frei
echo Einsatzplaner gestoppt.
endlocal
