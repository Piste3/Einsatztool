# Legt die Aufgabe "Einsatzplaner" in der Windows-Aufgabenplanung an.
# Auslöser: beim Systemstart. Konto: SYSTEM. Höchste Rechte. Kein Zeitlimit.
# Aufruf als Administrator:
#   powershell -ExecutionPolicy Bypass -File C:\einsatzplaner\app\betrieb\windows\aufgabe-einrichten.ps1
param([string]$Ordner = 'C:\einsatzplaner')

$start = Join-Path $Ordner 'start.cmd'
if (-not (Test-Path $start)) { throw "Datei fehlt: $start. Kopiere zuerst start.cmd und stop.cmd nach $Ordner." }

$aktion = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$start`"" -WorkingDirectory $Ordner
$ausloeser = New-ScheduledTaskTrigger -AtStartup
$konto = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$einstellungen = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Einsatzplaner' -Action $aktion -Trigger $ausloeser -Principal $konto -Settings $einstellungen -Force | Out-Null
Write-Host 'Aufgabe "Einsatzplaner" eingerichtet. Start jetzt: schtasks /Run /TN Einsatzplaner'
