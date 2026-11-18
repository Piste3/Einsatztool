# Einsatzplaner (Aufgebotstool) der Verkehrskadetten

Das Tool plant Einsätze, Schichten und Anmeldungen. Es druckt Aufgebote und sendet Bestätigungsmails.
Das Konzept liegt in `docs/Konzept.md`. Die Entscheide stehen in `CLAUDE.md`.

## Was du brauchst

- Node.js 22 (mit npm) und git.
- MySQL 8 oder MariaDB 10.6 oder neuer. Die Datenbank läuft auf demselben Rechner.
- Einen Reverse-Proxy mit HTTPS (z. B. IIS, Caddy oder nginx). Der Einsatzplaner selbst lauscht nur intern.

Sonst brauchst du nichts. Es gibt keinen Windows-Dienst und keine weiteren Werkzeuge.

## Installation unter Windows 11

Die Ordner sind fest:

| Ordner | Inhalt |
|---|---|
| `C:\einsatzplaner\app` | Code (dieses Repo) |
| `C:\einsatzplaner\data` | Daten und Import-Dateien |
| `C:\einsatzplaner\export` | Tagesexport und Sicherungen |
| `C:\einsatzplaner\logs` | Log-Dateien |
| `C:\einsatzplaner\einsatzplaner.env` | Konfiguration |

1. Hol den Code:
   ```
   git clone <repo-adresse> C:\einsatzplaner\app
   cd C:\einsatzplaner\app
   npm ci
   npm run build
   ```
2. Leg die Datenbank und den Benutzer an (in der MySQL- oder MariaDB-Konsole). Ersetze `<passwort>` durch ein zufälliges Passwort:
   ```sql
   CREATE DATABASE einsatzplaner CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
   CREATE USER 'einsatzplaner'@'localhost' IDENTIFIED BY '<passwort>';
   GRANT ALL PRIVILEGES ON einsatzplaner.* TO 'einsatzplaner'@'localhost';
   ```
   Ein zufälliges Passwort erzeugst du so:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
3. Kopiere `.env.example` nach `C:\einsatzplaner\einsatzplaner.env`. Trag die Werte ein. Die Felder mit `# TODO Yann` sind noch offen.
4. Kopiere die Skripte in den Hauptordner:
   ```
   copy C:\einsatzplaner\app\betrieb\windows\start.cmd C:\einsatzplaner\
   copy C:\einsatzplaner\app\betrieb\windows\stop.cmd C:\einsatzplaner\
   ```
   Die Skripte liegen bewusst ausserhalb von `app`. Ein Update ändert `app`. Ein laufendes Skript darf sich dabei nicht ändern.
5. Richte den Autostart ein (PowerShell als Administrator):
   ```
   powershell -ExecutionPolicy Bypass -File C:\einsatzplaner\app\betrieb\windows\aufgabe-einrichten.ps1
   ```
   Die Aufgabe heisst «Einsatzplaner». Sie startet beim Systemstart als `SYSTEM`, mit höchsten Rechten und ohne Zeitlimit.
6. Prüfe: `http://localhost:3010/health` zeigt `ok`.

Beim ersten Start legt das Tool die Tabellen selbst an.

## Starten, stoppen, Log ansehen (Windows)

- **Starten:** `schtasks /Run /TN Einsatzplaner`
- **Stoppen:** `C:\einsatzplaner\stop.cmd`
- **Log ansehen:** `powershell Get-Content C:\einsatzplaner\logs\einsatzplaner-JJJJ-MM-TT.log -Tail 50 -Wait`

`start.cmd` startet Node in einer Schleife. Beendet sich Node, startet das Skript Node nach 3 Sekunden neu.
`stop.cmd` legt die Datei `stop.flag` an. Node beendet sich dann sauber, und die Schleife endet.
Nach 20 Sekunden beendet `stop.cmd` den Node-Prozess auf dem Port des Einsatzplaners. Andere Node-Prozesse bleiben.

## Installation unter Linux

Gleich wie unter Windows, mit dem Hauptordner `/opt/einsatzplaner`:

```
git clone <repo-adresse> /opt/einsatzplaner/app
cd /opt/einsatzplaner/app && npm ci && npm run build
cp betrieb/linux/start.sh betrieb/linux/stop.sh /opt/einsatzplaner/
cp .env.example /opt/einsatzplaner/einsatzplaner.env   # Werte eintragen, DATA_DIR und EXPORT_DIR anpassen
```

- **Starten:** `/opt/einsatzplaner/start.sh &` oder mit systemd: `systemctl start einsatzplaner`
- **Stoppen:** `/opt/einsatzplaner/stop.sh`
- **Log ansehen:** `tail -f /opt/einsatzplaner/logs/einsatzplaner-$(date +%F).log`

Für den Autostart liegt eine Vorlage in `betrieb/linux/einsatzplaner.service`.

## Konfiguration

Alle Werte stehen in `.env.example` mit einer kurzen Erklärung. Das Tool liest die Datei aus `ENV_FILE` beim Start.
Umgebungsvariablen haben Vorrang vor der Datei. Server-Einstellungen gibt es nur in dieser Datei, nicht im Browser.

Wichtig:

- `SESSION_SECRET`: zufällig, mindestens 32 Zeichen.
- `BASE_URL`: die öffentliche Adresse mit `https://`. Nur dann setzt das Tool Cookies mit `Secure`.
- `LISTEN_HOST`: Standard `127.0.0.1`. Läuft der Reverse-Proxy auf einem anderen Rechner, setze die interne Adresse.
- Setze nie `DEV_LOGIN=1` auf dem Server. Der Test-Login ist nur für lokale Tests.

## Update über Admin › Update

1. Setze `UPDATE_ERLAUBT=1` in der Konfiguration.
2. Öffne Admin › Update. Klick «Auf Updates prüfen». Die Seite zeigt die neuen Commits.
3. Setz das Häkchen und klick «Update starten».

Das Tool sichert zuerst die Datenbank. Dann holt es den Code, installiert die Pakete und baut neu.
Danach beendet sich Node mit Code 75. `start.cmd` startet Node nach 3 Sekunden neu.
Bei einem Fehler setzt das Tool den Code auf den alten Commit zurück.
Git braucht für `git fetch` einen Zugang ohne Passwort-Abfrage (z. B. einen Deploy-Key).

## Sicherung und Wiederherstellung

- Der Tagesexport schreibt jede Nacht `datenbank-JJJJ-MM-TT.sql` nach `export\` und lädt die Datei nach SharePoint.
- Vor jedem Update entsteht eine Sicherung in `export\update-sicherung\`. Das Tool behält die 5 neuesten.

Wiederherstellen:

1. Stoppe den Einsatzplaner (`stop.cmd`).
2. Starte im Ordner `app`:
   ```
   set ENV_FILE=C:\einsatzplaner\einsatzplaner.env
   node dist\src\wiederherstellen.js C:\einsatzplaner\export\datenbank-JJJJ-MM-TT.sql --bestaetigt
   ```
   Ohne `--bestaetigt` ändert das Skript nichts. Vorher sichert es den aktuellen Stand.
3. Starte den Einsatzplaner wieder.

## Entwicklung und Tests

```
npm ci
npm run build
npm test
```

Die Tests brauchen einen MySQL- oder MariaDB-Server. Jeder Test legt eine eigene Datenbank `ep_test_…` an und löscht sie danach.
Der Test-Benutzer braucht das Recht, Datenbanken anzulegen und zu löschen. Verbindung über
`TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`.

Lokal ohne Microsoft Entra: `NODE_ENV=development` und `DEV_LOGIN=1` setzen, `ENTRA_TENANT_ID` leer lassen.
Der Server lauscht dann nur auf `127.0.0.1`.

## Aufbau

- `src/domain/`: alle Regeln. Die Routen rufen nur diese Funktionen auf.
- `src/web/`: Routen, HTML-Ansichten, CSS und wenig JavaScript.
- `src/db/`: Schema, Migrationen, Sicherung.
- `src/jobs/`: Mail-Versand, tägliche Jobs, iCal-Abgleich, Update.
- `test/`: ein Test je Regel aus Abschnitt 23 des Konzepts (T01–T25) und ein Rauchtest aller Seiten.
- `betrieb/`: Start- und Stoppskripte für Windows und Linux.
