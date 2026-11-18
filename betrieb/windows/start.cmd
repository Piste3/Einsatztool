@echo off
rem Einsatzplaner starten (Windows). Liegt in C:\einsatzplaner\start.cmd.
rem Startet Node in einer Schleife. Nach dem Ende (z. B. Exit-Code 75 nach einem Update) folgt nach 3 Sekunden ein Neustart.
rem Die Ausgabe geht nach logs\einsatzplaner-JJJJ-MM-TT.log.
rem stop.cmd legt die Datei stop.flag an. Dann beenden sich Node und die Schleife.
setlocal EnableExtensions
set "EP_ROOT=%~dp0"
if "%EP_ROOT:~-1%"=="\" set "EP_ROOT=%EP_ROOT:~0,-1%"
set "ENV_FILE=%EP_ROOT%\einsatzplaner.env"
set "STOP_DATEI=%EP_ROOT%\stop.flag"
set "LOG_DIR=%EP_ROOT%\logs"
set "NODE_ENV=production"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if exist "%STOP_DATEI%" del /q "%STOP_DATEI%"

rem Port aus der Konfiguration lesen (Standard 3010).
set "PORT_EP=3010"
if exist "%ENV_FILE%" for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do if /i "%%a"=="PORT" set "PORT_EP=%%b"

rem Nicht zweimal starten.
netstat -ano -p tcp | findstr /r /c:":%PORT_EP% .*LISTENING" >nul
if not errorlevel 1 (
  echo Der Port %PORT_EP% ist schon belegt. Der Einsatzplaner laeuft vermutlich schon.
  exit /b 1
)

cd /d "%EP_ROOT%\app" || exit /b 1

:schleife
if exist "%STOP_DATEI%" goto ende
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "HEUTE=%%d"
set "LOG=%LOG_DIR%\einsatzplaner-%HEUTE%.log"
echo [%date% %time%] Start >> "%LOG%"
node dist\src\server.js >> "%LOG%" 2>&1
set "CODE=%errorlevel%"
echo [%date% %time%] Node beendet, Code %CODE% >> "%LOG%"
if exist "%STOP_DATEI%" goto ende
rem 3 Sekunden warten. "timeout" geht ohne Konsole nicht, darum ping.
ping -n 4 127.0.0.1 >nul
goto schleife

:ende
del /q "%STOP_DATEI%" 2>nul
echo [%date% %time%] Gestoppt >> "%LOG%"
endlocal
