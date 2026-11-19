# Einsatzplaner (Aufgebotstool) der Verkehrskadetten

Das Tool plant Einsätze, Schichten und Anmeldungen. Es druckt Aufgebote und sendet Bestätigungsmails.
Das Konzept liegt in `docs/Konzept.md`. Die Entscheide stehen in `CLAUDE.md`.

## Inhalt

1. [Installation unter Windows 11](#installation-unter-windows-11)
2. [Login mit Microsoft Entra einrichten](#login-mit-microsoft-entra-einrichten)
3. [Starten, stoppen, Log lesen (Windows)](#starten-stoppen-log-lesen-windows)
4. [Häufige Fehler](#häufige-fehler)
5. [Installation unter Linux](#installation-unter-linux)
6. [Konfiguration](#konfiguration), [Update](#update-über-admin--update), [Mehrere Benutzer gleichzeitig](#mehrere-benutzer-gleichzeitig), [Sicherung](#sicherung-und-wiederherstellung), [Entwicklung](#entwicklung-und-tests)

---

## Installation unter Windows 11

Diese Anleitung zeigt jeden Schritt. Mach die Schritte in dieser Reihenfolge.
Für die ganze Installation brauchst du etwa eine Stunde.

### Schritt 0: Den Hauptordner wählen

Der Einsatzplaner liegt in einem Hauptordner. Der Standard ist `C:\einsatzplaner`.
Du darfst einen anderen Ordner wählen, z. B. `C:\Users\Home\Desktop\Holmium\Aufgebotstool`.
Wir empfehlen `C:\einsatzplaner`. Ein Ordner auf dem Desktop liegt oft in OneDrive. OneDrive kann Dateien sperren.

Im Hauptordner liegen am Ende diese Dateien und Ordner:

| Im Hauptordner | Inhalt | Wer legt es an? |
|---|---|---|
| `app\` | Code (dieses Repo) | du, mit `git clone` (Schritt 5) |
| `einsatzplaner.env` | Konfiguration | du (Schritt 7) |
| `start.cmd` | Startskript | du kopierst es (Schritt 8) |
| `stop.cmd` | Stoppskript | du kopierst es (Schritt 8) |
| `data\` | Daten und Import-Dateien | das Tool beim ersten Start |
| `export\` | Tagesexport und Sicherungen | das Tool beim ersten Start |
| `logs\` | Log-Dateien | `start.cmd` beim ersten Start |

Wichtig:

- Der Code muss im Unterordner `app` liegen. `start.cmd` sucht ihn genau dort.
- Die Konfiguration heisst `einsatzplaner.env`. Sie heisst **nicht** `.env`.
- `start.cmd` nimmt immer seinen eigenen Ordner als Hauptordner. Darum liegt `start.cmd` direkt im Hauptordner.

### Schritt 1: PowerShell öffnen

Du gibst die meisten Befehle in PowerShell ein.

1. Klick auf das Windows-Symbol (Start).
2. Tipp `PowerShell`.
3. Klick mit der rechten Maustaste auf «Windows PowerShell».
4. Klick auf «Als Administrator ausführen».
5. Klick bei der Frage «Möchten Sie zulassen …» auf «Ja».

Die Eingabezeile beginnt jetzt mit `PS C:\Windows\system32>`. Das ist PowerShell.

Gib jetzt deinen Hauptordner ein. Diese Zeile speichert den Pfad in der Variable `$H`:

```powershell
$H = "C:\einsatzplaner"
```

Mit eigenem Ordner schreibst du deinen Pfad zwischen die Anführungszeichen, z. B.:

```powershell
$H = "C:\Users\Home\Desktop\Holmium\Aufgebotstool"
```

> **Achtung:** PowerShell vergisst `$H`, wenn du das Fenster schliesst.
> Gib die Zeile in jedem neuen PowerShell-Fenster wieder ein.

Erlaube PowerShell einmal, Skripte wie `npm` auszuführen:

```powershell
Set-ExecutionPolicy -Scope LocalMachine RemoteSigned
```

Antworte mit `J` (oder `A` für «Alle») und drück Enter.

### Schritt 2: Node.js installieren

1. Öffne <https://nodejs.org/> im Browser.
2. Lade die Version **22 LTS** für Windows herunter (Datei «Windows Installer (.msi)», 64-Bit).
3. Starte die Datei. Klick immer auf «Next». Lass alle Häkchen, wie sie sind.
4. Klick am Ende auf «Finish».
5. **Schliess PowerShell und öffne es neu** (Schritt 1). Erst dann kennt PowerShell den Befehl `node`.
6. Prüfe die Installation:
   ```powershell
   node -v
   npm -v
   ```
   `node -v` zeigt eine Zahl mit `v22.` am Anfang, z. B. `v22.12.0`. `npm -v` zeigt eine Zahl, z. B. `10.9.0`.

### Schritt 3: Git installieren

1. Öffne <https://git-scm.com/download/win> im Browser.
2. Lade «64-bit Git for Windows Setup» herunter.
3. Starte die Datei. Klick immer auf «Next». Die Standardwerte passen.
4. Klick am Ende auf «Finish».
5. **Schliess PowerShell und öffne es neu.** Gib `$H = "…"` wieder ein.
6. Prüfe die Installation:
   ```powershell
   git --version
   ```
   Die Ausgabe sieht so aus: `git version 2.47.1.windows.1`.

### Schritt 4: MariaDB installieren

MariaDB ist die Datenbank. MySQL 8 geht auch. Diese Anleitung zeigt MariaDB.

1. Öffne <https://mariadb.org/download/> im Browser.
2. Wähl die neueste stabile Version, «MS Windows (64-bit)» und «MSI Package». Lade die Datei herunter.
3. Starte die Datei. Klick auf «Next» und akzeptiere die Lizenz.
4. Bei «Custom Setup» klick auf «Next». Die Standardwerte passen.
5. Bei «User settings»:
   - Gib ein **Root-Passwort** ein, zweimal. Root ist der Hauptbenutzer der Datenbank.
   - **Schreib das Root-Passwort auf.** Du brauchst es in Schritt 6.
   - Lass «Enable access from remote machines for 'root' user» **ohne** Häkchen.
   - Setz das Häkchen bei «Use UTF8 as default server's character set».
6. Bei «Default instance properties»:
   - «Install as service»: Häkchen lassen. Der Dienstname ist `MariaDB`.
   - «Enable networking»: Häkchen lassen. Der Port ist `3306`.
7. Klick auf «Next» und dann auf «Install». Klick am Ende auf «Finish».

MariaDB startet jetzt automatisch, auch nach jedem Neustart von Windows.

### Schritt 5: Den Code holen und bauen

1. Leg den Hauptordner an und hol den Code:
   ```powershell
   New-Item -ItemType Directory -Force -Path $H
   git clone https://github.com/Piste3/Einsatztool.git "$H\app"
   ```
   Ist das Repo privat, öffnet Git ein Fenster für die Anmeldung bei GitHub. Melde dich dort an.
2. Wechsle in den Ordner `app`:
   ```powershell
   cd "$H\app"
   ```
3. Installiere die Pakete:
   ```powershell
   npm ci --include=dev
   ```
   Das dauert etwa eine Minute. Am Ende steht z. B. `added 120 packages`. Warnungen («npm warn») sind kein Problem.
4. Baue das Tool:
   ```powershell
   npm run build
   ```
   Der Befehl zeigt keine Fehler. Danach gibt es die Datei `$H\app\dist\src\server.js`.
5. Prüfe das:
   ```powershell
   Test-Path "$H\app\dist\src\server.js"
   ```
   Die Ausgabe ist `True`.

### Schritt 6: Datenbank und Datenbank-Benutzer anlegen

Hier gibst du SQL-Befehle ein. **SQL-Befehle gehören nicht in PowerShell.**
Du startest zuerst den MariaDB-Client. Erst dort gibst du die SQL-Befehle ein.

**6.1 Den MariaDB-Client finden**

Der Befehl `mysql` ist nicht im Suchpfad von Windows. Du brauchst den vollen Pfad.
Diesen Befehl in PowerShell eingeben. Er sucht die Datei `mysql.exe`:

```powershell
Get-ChildItem "C:\Program Files" -Recurse -Filter mysql.exe -ErrorAction SilentlyContinue | Select-Object FullName
```

Die Ausgabe zeigt den Pfad, z. B.:

```
FullName
--------
C:\Program Files\MariaDB 13.0\bin\mysql.exe
```

Die Zahl nach «MariaDB» ist deine Version. Sie kann anders sein. Nimm den Pfad aus deiner Ausgabe.

**6.2 Ein Passwort für den Datenbank-Benutzer erzeugen**

Der Einsatzplaner meldet sich mit einem eigenen Benutzer `einsatzplaner` an der Datenbank an.
Dieser Befehl erzeugt ein zufälliges Passwort:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Die Ausgabe ist eine lange Zeichenfolge, z. B. `3f9a1c…`. Kopiere sie in eine Textdatei. Du brauchst sie zweimal.

Regeln für ein eigenes Passwort:

- Nur Buchstaben und Ziffern. Keine Leerzeichen.
- Kein `#`, keine Anführungszeichen (`"` oder `'`), keine spitzen Klammern (`<` oder `>`).

**6.3 Den MariaDB-Client starten**

Gib in PowerShell diesen Befehl ein. Nimm deinen Pfad aus 6.1. Das `&` am Anfang muss dabei sein:

```powershell
& "C:\Program Files\MariaDB 13.0\bin\mysql.exe" -u root -p
```

Der Client fragt `Enter password:`. Gib das Root-Passwort aus Schritt 4 ein und drück Enter.
Beim Tippen zeigt das Fenster keine Zeichen. Das ist normal.

Die Eingabezeile zeigt jetzt:

```
MariaDB [(none)]>
```

Erst jetzt bist du im MariaDB-Client. Hier gehören die SQL-Befehle hin.

**6.4 Die SQL-Befehle eingeben**

Ersetze `MeinDbPasswort123` an **beiden** Stellen durch dein Passwort aus 6.2.
Lass die einfachen Anführungszeichen `'…'` um das Passwort stehen.
Jeder Befehl endet mit einem Strichpunkt `;`. Gib die Befehle einzeln ein und drück nach jedem Befehl Enter.

```sql
CREATE DATABASE einsatzplaner CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'einsatzplaner'@'localhost' IDENTIFIED BY 'MeinDbPasswort123';
CREATE USER 'einsatzplaner'@'127.0.0.1' IDENTIFIED BY 'MeinDbPasswort123';
GRANT ALL PRIVILEGES ON einsatzplaner.* TO 'einsatzplaner'@'localhost';
GRANT ALL PRIVILEGES ON einsatzplaner.* TO 'einsatzplaner'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Nach jedem Befehl zeigt der Client `Query OK`.

Warum zwei Benutzer? Das Tool verbindet sich über `127.0.0.1`. MariaDB unterscheidet `localhost` und `127.0.0.1`.
Mit beiden Einträgen klappt die Anmeldung in jedem Fall.

**6.5 Den Benutzer testen**

Verlass den Client:

```sql
exit
```

Die Eingabezeile zeigt wieder `PS …>`. Teste jetzt den neuen Benutzer (Pfad aus 6.1):

```powershell
& "C:\Program Files\MariaDB 13.0\bin\mysql.exe" -u einsatzplaner -p -h 127.0.0.1 einsatzplaner
```

Gib das Passwort aus 6.2 ein. Die Eingabezeile zeigt `MariaDB [einsatzplaner]>`. Der Benutzer funktioniert.
Verlass den Client wieder mit `exit`.

### Schritt 7: Die Konfiguration anlegen

1. Kopiere die Vorlage in den Hauptordner:
   ```powershell
   Copy-Item "$H\app\.env.example" "$H\einsatzplaner.env"
   ```
2. Öffne die Datei im Editor:
   ```powershell
   notepad "$H\einsatzplaner.env"
   ```
3. Erzeuge einen Schlüssel für `SESSION_SECRET`. Gib in PowerShell ein:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Kopiere die Ausgabe.
4. Trag im Editor diese Werte ein. Schreib den Wert direkt nach dem `=`, ohne Leerzeichen und ohne Anführungszeichen:

   | Zeile | Wert |
   |---|---|
   | `SESSION_SECRET=` | der Schlüssel aus Punkt 3 |
   | `DB_HOST=` | `127.0.0.1` (so lassen) |
   | `DB_USER=` | `einsatzplaner` (so lassen) |
   | `DB_PASSWORD=` | **dasselbe** Passwort wie in Schritt 6.4 |
   | `DATA_DIR=` | dein Hauptordner mit `\data`, z. B. `C:\einsatzplaner\data` |
   | `EXPORT_DIR=` | dein Hauptordner mit `\export`, z. B. `C:\einsatzplaner\export` |
   | `BASE_URL=` | die öffentliche Adresse mit `https://`. Für den ersten Test: `http://localhost:3010` |

   Beispiel mit eigenem Hauptordner:

   ```
   DATA_DIR=C:\Users\Home\Desktop\Holmium\Aufgebotstool\data
   EXPORT_DIR=C:\Users\Home\Desktop\Holmium\Aufgebotstool\export
   ```

   Die Werte für Entra, Mail und SharePoint trägst du später ein. Sie tragen den Hinweis `# TODO Yann`.
   Der Login mit Microsoft Entra steht im [nächsten Kapitel](#login-mit-microsoft-entra-einrichten).
5. Speichere die Datei mit Ctrl+S. Schliess den Editor.
6. Prüfe den Dateinamen. Der Editor hängt manchmal `.txt` an:
   ```powershell
   Get-ChildItem $H
   ```
   Die Liste zeigt `einsatzplaner.env`. Steht dort `einsatzplaner.env.txt`, benenne die Datei um:
   ```powershell
   Rename-Item "$H\einsatzplaner.env.txt" "einsatzplaner.env"
   ```

### Schritt 8: Die Skripte in den Hauptordner kopieren

```powershell
Copy-Item "$H\app\betrieb\windows\start.cmd" "$H\"
Copy-Item "$H\app\betrieb\windows\stop.cmd" "$H\"
```

Die Skripte liegen bewusst ausserhalb von `app`. Ein Update ändert `app`. Ein laufendes Skript darf sich dabei nicht ändern.

### Schritt 9: Der erste Start von Hand

1. Öffne den Hauptordner im Explorer:
   ```powershell
   explorer $H
   ```
2. Doppelklick auf `start.cmd`.
3. Ein schwarzes Fenster geht auf. **Das Fenster bleibt leer. Das ist richtig.**
   Alle Meldungen gehen in die Log-Datei im Ordner `logs`.
   Lass das Fenster offen. Schliesst du das Fenster, stoppt der Einsatzplaner.
4. Warte 10 Sekunden.
5. Öffne im Browser <http://localhost:3010/health>. Die Seite zeigt `ok`.
6. Lies die Log-Datei. Gib in PowerShell ein:
   ```powershell
   Get-ChildItem "$H\logs" | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Tail 30
   ```
   Ein guter Start zeigt diese zwei Zeilen:
   ```
   … INFO Datenbank bereit (Schema-Version …).
   … INFO Einsatzplaner läuft auf http://127.0.0.1:3010 …
   ```
   Beim ersten Start legt das Tool die Tabellen selbst an.
   Zeigt der Browser nichts oder steht `ERROR` im Log, lies [Häufige Fehler](#häufige-fehler).
7. Stoppe den Einsatzplaner wieder. Doppelklick auf `stop.cmd` im Hauptordner.
   Nach einigen Sekunden schliesst sich das schwarze Fenster von `start.cmd`.

### Schritt 10: Den Autostart einrichten

Der Autostart nutzt die Windows-Aufgabenplanung. Die Aufgabe startet beim Systemstart als `SYSTEM`.
Es braucht dafür keine Anmeldung an Windows.

1. Gib in PowerShell (als Administrator, Schritt 1) ein:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "$H\app\betrieb\windows\aufgabe-einrichten.ps1" -Ordner $H
   ```
   Die Ausgabe ist: `Aufgabe "Einsatzplaner" eingerichtet.`
   Ohne `-Ordner` nimmt das Skript `C:\einsatzplaner`. Mit eigenem Hauptordner brauchst du `-Ordner $H` unbedingt.
2. Starte die Aufgabe jetzt:
   ```powershell
   schtasks /Run /TN Einsatzplaner
   ```
   Diesmal geht kein Fenster auf. Der Einsatzplaner läuft im Hintergrund.
3. Warte 10 Sekunden. Öffne <http://localhost:3010/health>. Die Seite zeigt `ok`.

Die Aufgabe heisst «Einsatzplaner». Sie läuft mit höchsten Rechten und ohne Zeitlimit.
Du siehst sie in der App «Aufgabenplanung» unter «Aufgabenplanungsbibliothek».

### Schritt 11: Den Reverse-Proxy mit HTTPS einrichten

Der Einsatzplaner lauscht nur auf `127.0.0.1:3010`. Andere Rechner erreichen ihn nicht direkt.
Für den Zugriff von aussen brauchst du einen Reverse-Proxy mit HTTPS, z. B. IIS, Caddy oder nginx.
Der Proxy leitet alle Anfragen an `http://127.0.0.1:3010` weiter.
Setz danach `BASE_URL` in `einsatzplaner.env` auf die öffentliche Adresse, z. B. `https://einsatzplaner.kkb.ch`.
Starte den Einsatzplaner danach neu (siehe [Starten, stoppen](#starten-stoppen-log-lesen-windows)).

---

## Login mit Microsoft Entra einrichten

Benutzer melden sich mit ihrem Microsoft-Konto an. Dafür registrierst du das Tool als App in Microsoft Entra.
Dafür brauchst du ein Konto mit Admin-Rechten in Entra.

### Die App registrieren

1. Öffne <https://entra.microsoft.com> und melde dich an.
2. Klick links auf «Identität» › «Anwendungen» › «App-Registrierungen».
3. Klick oben auf «Neue Registrierung».
4. Gib einen Namen ein, z. B. `Einsatzplaner`.
5. Wähl bei «Unterstützte Kontotypen»: «Nur Konten in diesem Organisationsverzeichnis».
6. Wähl bei «Umleitungs-URI»: Plattform «Web». Gib die Adresse ein: deine `BASE_URL` mit `/login/callback`.
   - Beispiel Server: `https://einsatzplaner.kkb.ch/login/callback`
   - Beispiel erster Test: `http://localhost:3010/login/callback`
   - Du darfst beide Adressen eintragen. Weitere Adressen fügst du später unter «Authentifizierung» hinzu.
7. Klick auf «Registrieren».

### Tenant-ID und Client-ID finden

Nach der Registrierung siehst du die Seite «Übersicht» der App.
Du findest sie später wieder: «App-Registrierungen» › deine App › «Übersicht».

| Auf der Seite «Übersicht» | Zeile in `einsatzplaner.env` |
|---|---|
| «Verzeichnis-ID (Mandant)» | `ENTRA_TENANT_ID=` |
| «Anwendungs-ID (Client)» | `ENTRA_CLIENT_ID=` |

Neben jedem Wert steht ein Symbol zum Kopieren.

### Client Secret erzeugen

1. Klick in der App links auf «Zertifikate & Geheimnisse».
2. Klick auf «Neuer geheimer Clientschlüssel».
3. Gib eine Beschreibung ein, z. B. `Einsatzplaner Server`. Wähl eine Gültigkeit, z. B. 24 Monate.
4. Klick auf «Hinzufügen».
5. **Kopiere sofort den Inhalt der Spalte «Wert».** Entra zeigt den Wert nur jetzt. Nach dem Verlassen der Seite ist er verdeckt.
6. Trag den Wert in `ENTRA_CLIENT_SECRET=` ein.

> **Achtung:** Nimm die Spalte «Wert», nicht die Spalte «Geheimnis-ID».
> Hast du den Wert verpasst, lösch den Schlüssel und erzeuge einen neuen.
> Schreib dir das Ablaufdatum auf. Vor dem Ablauf erzeugst du einen neuen Schlüssel.

### App-Rollen anlegen und zuweisen

Das Tool kennt zwei Rollen: `Admin` und `Aufgebot`. Ohne Rolle kommt niemand hinein.

1. Klick in der App links auf «App-Rollen» › «App-Rolle erstellen».
2. Fülle aus: Anzeigename `Admin`, zulässige Mitgliedstypen «Benutzer/Gruppen», Wert `Admin`, eine Beschreibung. Klick auf «Übernehmen».
3. Mach dasselbe für die Rolle `Aufgebot` (Wert `Aufgebot`).
4. Klick links auf «Identität» › «Anwendungen» › «Unternehmensanwendungen». Öffne die App «Einsatzplaner».
5. Klick auf «Benutzer und Gruppen» › «Benutzer/Gruppe hinzufügen».
6. Wähl die Personen und die Rolle. Klick auf «Zuweisen».

Der erste Admin entsteht beim ersten Login einer Person mit der Rolle `Admin`.

### Den Einsatzplaner neu starten

Speichere `einsatzplaner.env`. Starte den Einsatzplaner neu:

```powershell
& "$H\stop.cmd"
schtasks /Run /TN Einsatzplaner
```

Öffne die Adresse aus `BASE_URL` im Browser. Das Tool leitet dich zur Anmeldung bei Microsoft weiter.

Der Tagesexport nach SharePoint nutzt dieselbe App. Er braucht zusätzlich die Berechtigung `Sites.Selected` und die Werte `SHAREPOINT_SITE_ID` und `SHAREPOINT_DRIVE_ID`.
Ohne diese Werte schreibt der Tagesexport die Dateien nur in den Ordner `export`.

---

## Starten, stoppen, Log lesen (Windows)

Gib zuerst in PowerShell deinen Hauptordner ein: `$H = "C:\einsatzplaner"`.

| Was | Befehl in PowerShell |
|---|---|
| Starten | `schtasks /Run /TN Einsatzplaner` |
| Stoppen | `& "$H\stop.cmd"` |
| Neu starten | zuerst stoppen, dann starten |
| Läuft er? | Browser: <http://localhost:3010/health> zeigt `ok` |
| Log lesen (letzte 50 Zeilen) | `Get-ChildItem "$H\logs" \| Sort-Object LastWriteTime \| Select-Object -Last 1 \| Get-Content -Tail 50` |
| Log live mitlesen | `Get-ChildItem "$H\logs" \| Sort-Object LastWriteTime \| Select-Object -Last 1 \| Get-Content -Tail 50 -Wait` |

Beim Mitlesen beendest du die Anzeige mit Ctrl+C. Der Einsatzplaner läuft dabei weiter.

So arbeiten die Skripte:

- Die Log-Datei heisst `logs\einsatzplaner-JJJJ-MM-TT.log`. Das Datum ist der Tag des Starts von Node.
- `start.cmd` startet Node in einer Schleife. Beendet sich Node, startet `start.cmd` Node nach 3 Sekunden neu.
- `stop.cmd` legt die Datei `stop.flag` an. Node beendet sich dann sauber, und die Schleife endet.
- Nach 20 Sekunden beendet `stop.cmd` den Node-Prozess auf dem Port des Einsatzplaners. Andere Node-Prozesse bleiben.

---

## Häufige Fehler

### SQL-Befehle in PowerShell eingegeben

Meldung in PowerShell, z. B.:

```
CREATE : Die Benennung "CREATE" wurde nicht als Name eines Cmdlet … erkannt.
```

Ursache: PowerShell kennt keine SQL-Befehle.
Lösung: Starte zuerst den MariaDB-Client ([Schritt 6.3](#schritt-6-datenbank-und-datenbank-benutzer-anlegen)).
Die Eingabezeile zeigt dann `MariaDB [(none)]>`. Gib die SQL-Befehle erst dort ein.

### `mysql` wird nicht gefunden

Meldung:

```
mysql : Die Benennung "mysql" wurde nicht als Name eines Cmdlet … erkannt.
```

Ursache: Der Ordner von MariaDB ist nicht im Suchpfad.
Lösung: Such den Pfad mit `Get-ChildItem` ([Schritt 6.1](#schritt-6-datenbank-und-datenbank-benutzer-anlegen)).
Starte den Client mit `&` und dem vollen Pfad in Anführungszeichen:

```powershell
& "C:\Program Files\MariaDB 13.0\bin\mysql.exe" -u root -p
```

Ohne `&` zeigt PowerShell nur den Text an oder meldet einen Fehler.

### Fehler wegen `<` oder `>` in einem Befehl

Meldung, z. B.:

```
Der Operator "<" ist für zukünftige Versionen reserviert.
```

Ursache: Du hast einen Platzhalter mit spitzen Klammern (z. B. `<passwort>`) wörtlich eingegeben.
PowerShell liest `<` und `>` als Sonderzeichen.
Lösung: Ersetze den ganzen Platzhalter durch den echten Wert, ohne die spitzen Klammern.
Nimm ein Passwort ohne Leerzeichen, ohne `#` und ohne Anführungszeichen.

### Root-Passwort von MariaDB vergessen

Meldung beim Start des Clients:

```
ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: YES)
```

Lösung A: Root-Passwort zurücksetzen. Du brauchst zwei PowerShell-Fenster als Administrator.

1. Fenster 1: Stoppe den Dienst von MariaDB:
   ```powershell
   Stop-Service MariaDB
   ```
2. Fenster 1: Starte MariaDB ohne Passwortprüfung (Pfad aus Schritt 6.1, aber `mysqld.exe` statt `mysql.exe`):
   ```powershell
   & "C:\Program Files\MariaDB 13.0\bin\mysqld.exe" --defaults-file="C:\Program Files\MariaDB 13.0\data\my.ini" --skip-grant-tables --console
   ```
   Das Fenster bleibt offen und zeigt Meldungen. Lass es offen.
3. Fenster 2: Starte den Client ohne Passwort:
   ```powershell
   & "C:\Program Files\MariaDB 13.0\bin\mysql.exe" -u root
   ```
4. Fenster 2: Gib im Client diese zwei Befehle ein. Ersetze `NeuesRootPasswort1` durch dein neues Passwort:
   ```sql
   FLUSH PRIVILEGES;
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'NeuesRootPasswort1';
   exit
   ```
5. Fenster 1: Drück Ctrl+C. MariaDB beendet sich.
6. Starte den Dienst wieder:
   ```powershell
   Start-Service MariaDB
   ```
7. Teste das neue Passwort mit Schritt 6.3.

Lösung B: MariaDB neu installieren. Das löscht **alle** Datenbanken auf diesem Rechner.
Nimm diesen Weg nur bei einer neuen Installation ohne Daten.

1. Öffne «Einstellungen» › «Apps» › «Installierte Apps». Deinstalliere MariaDB.
2. Lösch den Ordner `C:\Program Files\MariaDB 13.0` (mit dem Unterordner `data`).
3. Installiere MariaDB neu (Schritt 4). Schreib das Root-Passwort diesmal auf.

### Datenbank-Benutzer wird abgelehnt

Meldung im Log:

```
Access denied for user 'einsatzplaner'@'localhost' (using password: YES)
```

Ursache: Der Benutzer fehlt für `127.0.0.1`, oder das Passwort stimmt nicht.
Lösung:

1. Starte den Client als root (Schritt 6.3).
2. Gib diese Befehle ein. Nimm dasselbe Passwort wie in `DB_PASSWORD`:
   ```sql
   CREATE USER IF NOT EXISTS 'einsatzplaner'@'127.0.0.1' IDENTIFIED BY 'MeinDbPasswort123';
   ALTER USER 'einsatzplaner'@'localhost' IDENTIFIED BY 'MeinDbPasswort123';
   ALTER USER 'einsatzplaner'@'127.0.0.1' IDENTIFIED BY 'MeinDbPasswort123';
   GRANT ALL PRIVILEGES ON einsatzplaner.* TO 'einsatzplaner'@'localhost';
   GRANT ALL PRIVILEGES ON einsatzplaner.* TO 'einsatzplaner'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```
3. Prüfe `DB_PASSWORD=` in `einsatzplaner.env`. Der Wert steht ohne Leerzeichen und ohne Anführungszeichen.
4. Starte den Einsatzplaner neu.

Steht im Log `(using password: NO)`, findet das Tool kein Passwort.
Dann fehlt `einsatzplaner.env` im Hauptordner, oder `DB_PASSWORD=` ist leer. Prüfe auch den Dateinamen (Schritt 7, Punkt 6).

### Datenbank nicht erreichbar

Meldung im Log:

```
connect ECONNREFUSED 127.0.0.1:3306
```

Ursache: MariaDB läuft nicht.
Lösung: Starte den Dienst: `Start-Service MariaDB`. Prüfe den Dienst mit `Get-Service MariaDB`. Der Status ist `Running`.

### Datenbank fehlt

Meldung im Log:

```
Unknown database 'einsatzplaner'
```

Lösung: Leg die Datenbank an (Schritt 6.4, erster Befehl).

### `SESSION_SECRET` fehlt

Meldung im Log:

```
SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.
```

Lösung: Erzeuge einen Schlüssel (Schritt 7, Punkt 3). Trag ihn in `SESSION_SECRET=` ein. Starte neu.

### Server-Datei fehlt

Meldung im Log:

```
Cannot find module 'C:\…\app\dist\src\server.js'
```

Ursache: Der Code liegt nicht im Unterordner `app`, oder `npm run build` fehlt.
Lösung: Prüfe, dass der Ordner `app` direkt neben `start.cmd` liegt. Starte im Ordner `app` `npm ci --include=dev` und `npm run build`.

### Das Fenster von `start.cmd` bleibt leer

Das ist kein Fehler. Alle Meldungen gehen in die Log-Datei. Lies das Log mit dem Befehl aus [Starten, stoppen, Log lesen](#starten-stoppen-log-lesen-windows).

### Das Fenster von `start.cmd` schliesst sich sofort

Ursache 1: Der Port 3010 ist belegt. Der Einsatzplaner läuft vermutlich schon (z. B. über die Aufgabenplanung).
Prüfe das mit <http://localhost:3010/health>. Zum Neustart erst `stop.cmd`, dann `start.cmd`.

Ursache 2: Der Ordner `app` fehlt im Hauptordner. Prüfe den Aufbau aus [Schritt 0](#schritt-0-den-hauptordner-wählen).

Die Meldung siehst du, wenn du `start.cmd` in PowerShell startest: `& "$H\start.cmd"`.

### `npm` darf nicht ausgeführt werden

Meldung:

```
Die Datei "C:\Program Files\nodejs\npm.ps1" kann nicht geladen werden, da die Ausführung von Skripts auf diesem System deaktiviert ist.
```

Lösung: Gib in PowerShell als Administrator ein: `Set-ExecutionPolicy -Scope LocalMachine RemoteSigned`. Antworte mit `J`.

### `node` oder `git` wird nicht gefunden

Meldung: `Die Benennung "node" wurde nicht … erkannt.`
Ursache: PowerShell war schon vor der Installation offen.
Lösung: Schliess PowerShell und öffne es neu.

### `/health` antwortet nicht

Der Browser meldet «Diese Seite ist nicht erreichbar» oder «ERR_CONNECTION_REFUSED».

1. Warte 10 Sekunden und lade die Seite neu.
2. Lies das Log. Such nach `ERROR`.
3. Steht im Log nichts Neues, läuft der Einsatzplaner nicht. Starte ihn (`schtasks /Run /TN Einsatzplaner`).
4. Prüfe die Aufgabe in der App «Aufgabenplanung». Die Spalte «Letztes Ergebnis» zeigt einen Fehlercode.

### Die Aufgabe startet mit eigenem Hauptordner nicht

Meldung beim Einrichten: `Datei fehlt: C:\einsatzplaner\start.cmd`.
Ursache: `-Ordner` fehlt beim Aufruf von `aufgabe-einrichten.ps1`.
Lösung: Starte das Skript mit `-Ordner $H` ([Schritt 10](#schritt-10-den-autostart-einrichten)).

### Login: «Login nicht eingerichtet»

Ursache: `ENTRA_TENANT_ID` oder `ENTRA_CLIENT_ID` fehlt in `einsatzplaner.env`.
Lösung: Trag die Werte ein ([Login mit Microsoft Entra](#login-mit-microsoft-entra-einrichten)). Starte neu.

### Login: Microsoft meldet `AADSTS50011`

Ursache: Die Umleitungs-URI in Entra passt nicht zu `BASE_URL`.
Lösung: Trag in Entra unter «Authentifizierung» genau `BASE_URL` + `/login/callback` ein. Gross- und Kleinschreibung zählen.

### Login: Microsoft meldet `AADSTS7000215`

Ursache: Das Client Secret ist falsch. Oft steht die «Geheimnis-ID» statt des «Werts» in der Datei.
Lösung: Erzeuge einen neuen Schlüssel. Kopiere die Spalte «Wert» ([Client Secret](#client-secret-erzeugen)).

### Login: «Dein Konto hat weder die Rolle Admin noch Aufgebot»

Ursache: Deinem Konto fehlt die App-Rolle.
Lösung: Weise die Rolle in Entra zu ([App-Rollen](#app-rollen-anlegen-und-zuweisen)). Melde dich ab und wieder an.

### Update: Git meldet `dubious ownership`

Meldung auf der Seite Admin › Update:

```
fatal: detected dubious ownership in repository at 'C:/einsatzplaner/app'
```

Ursache: Die Aufgabe läuft als `SYSTEM`. Der Ordner `app` gehört deinem Windows-Benutzer.
Lösung: Gib in PowerShell als Administrator ein (mit deinem Pfad, mit `/` statt `\`):

```powershell
git config --system --add safe.directory C:/einsatzplaner/app
```

---

## Installation unter Linux

Unter Linux gelten dieselben Schritte. Der Standard-Hauptordner ist `/opt/einsatzplaner`. Du darfst einen anderen Ordner wählen.
`start.sh` nimmt wie `start.cmd` seinen eigenen Ordner als Hauptordner. Der Code liegt im Unterordner `app`.

1. Installiere Node.js 22, git und MariaDB, z. B. unter Debian oder Ubuntu:
   ```sh
   sudo apt install git mariadb-server
   ```
   Node.js 22 installierst du nach <https://nodejs.org/en/download> (Paketquelle von NodeSource oder `nvm`).
2. Hol den Code und baue ihn:
   ```sh
   H=/opt/einsatzplaner
   sudo mkdir -p $H && sudo chown "$USER" $H
   git clone https://github.com/Piste3/Einsatztool.git $H/app
   cd $H/app && npm ci --include=dev && npm run build
   ```
3. Leg Datenbank und Benutzer an. Starte zuerst den Client mit `sudo mariadb`. Die Eingabezeile zeigt `MariaDB [(none)]>`.
   Gib dann die SQL-Befehle aus [Schritt 6.4](#schritt-6-datenbank-und-datenbank-benutzer-anlegen) ein. Verlass den Client mit `exit`.
4. Leg die Konfiguration an und trag die Werte ein (wie [Schritt 7](#schritt-7-die-konfiguration-anlegen)):
   ```sh
   cp $H/app/.env.example $H/einsatzplaner.env
   nano $H/einsatzplaner.env
   ```
   Setz `DATA_DIR=/opt/einsatzplaner/data` und `EXPORT_DIR=/opt/einsatzplaner/export` (oder deinen Hauptordner).
5. Kopiere die Skripte:
   ```sh
   cp $H/app/betrieb/linux/start.sh $H/app/betrieb/linux/stop.sh $H/
   chmod +x $H/start.sh $H/stop.sh
   ```
6. Erster Test: `$H/start.sh &`. Prüfe mit `curl http://localhost:3010/health`. Die Ausgabe ist `ok`. Stoppe mit `$H/stop.sh`.
7. Autostart mit systemd: Kopiere `betrieb/linux/einsatzplaner.service` nach `/etc/systemd/system/`.
   Passe darin `User=` und die Pfade an. Starte dann:
   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now einsatzplaner
   ```

| Was | Befehl |
|---|---|
| Starten | `sudo systemctl start einsatzplaner` |
| Stoppen | `sudo systemctl stop einsatzplaner` |
| Log lesen | `tail -n 50 -f $H/logs/einsatzplaner-$(date +%F).log` |

Die Fehler aus [Häufige Fehler](#häufige-fehler) gelten auch unter Linux. Die Lösungen für PowerShell entfallen.

---

## Konfiguration

Alle Werte stehen in `.env.example` mit einer kurzen Erklärung. Das Tool liest die Datei aus `ENV_FILE` beim Start.
`start.cmd` und `start.sh` setzen `ENV_FILE` auf `einsatzplaner.env` im Hauptordner.
Umgebungsvariablen haben Vorrang vor der Datei.
Nach jeder Änderung an der Datei startest du den Einsatzplaner neu.

### Konfiguration im Browser (Admin › Konfiguration)

Ein Admin sieht und ändert alle Werte der Datei auch im Browser, unter Admin › Konfiguration.

- Die Seite schreibt direkt in `einsatzplaner.env`. Es gibt keine zweite Quelle.
- Den alten Stand legt das Tool als `einsatzplaner.env.vorher` daneben.
- Änderungen wirken erst nach einem Neustart. Der Knopf «Neu starten» beendet Node mit Code 75. `start.cmd` startet Node nach 3 Sekunden neu.
- Passwörter und Schlüssel zeigt die Seite nie an. Ein leeres Feld lässt den Wert unverändert.
- Neue Datenbank-Werte prüft das Tool vor dem Speichern. Ist die Datenbank nicht erreichbar, speichert es nur mit dem Häkchen «Trotzdem speichern».
- Der Knopf «Testmail senden» prüft die gespeicherten SMTP-Werte.
- `MAIL_INFORMATIK` ist die Adresse der Informatik. Der Knopf «Änderung melden» auf der Personenseite öffnet eine Mail an diese Adresse. Die Mail ist eine Vorlage: Du trägst jede Änderung direkt ein. Der alte Name `MAIL_ROMAN` gilt weiter.
- Das Protokoll zeigt, wer wann welchen Wert geändert hat. Geheimnisse stehen dort nur als «(gesetzt)» oder «(leer)».
- Ein Wert aus einer echten Umgebungsvariablen ist gesperrt. Die Seite zeigt ihn nur an.

Ein falscher Wert bei Port, Adresse, Datenbank oder Entra kann den Zugang sperren.
Dann öffnest du `einsatzplaner.env` auf dem Server mit Notepad und korrigierst den Wert.
Die Datei `einsatzplaner.env.vorher` enthält den Stand vor der letzten Änderung.

Wichtig:

- `SESSION_SECRET`: zufällig, mindestens 32 Zeichen.
- `BASE_URL`: die öffentliche Adresse mit `https://`. Nur dann setzt das Tool Cookies mit `Secure`.
- `LISTEN_HOST`: Standard `127.0.0.1`. Läuft der Reverse-Proxy auf einem anderen Rechner, setze die interne Adresse.
- Setze nie `DEV_LOGIN=1` auf dem Server. Der Test-Login ist nur für lokale Tests.

## Update über Admin › Update

1. Setze `UPDATE_ERLAUBT=1` in der Konfiguration.
2. Öffne Admin › Update. Oben stehen zwei Knöpfe.
3. «Nach Updates suchen» zeigt, ob es einen neuen Stand gibt.
4. «Update installieren» installiert den neuen Stand. Der Browser fragt einmal nach.

Das Tool sichert zuerst die Datenbank und die Konfiguration (`export\update-sicherung\`). Dann holt es den Code, installiert die Pakete und baut neu.
Danach beendet sich Node mit Code 75. `start.cmd` startet Node nach 3 Sekunden neu.
Bei einem Fehler setzt das Tool den Code auf den alten Commit zurück.
Git braucht für `git fetch` einen Zugang ohne Passwort-Abfrage (z. B. einen Deploy-Key).
Die Aufgabe läuft als `SYSTEM`. Darum braucht Git den Eintrag `safe.directory` (siehe [Häufige Fehler](#update-git-meldet-dubious-ownership)).

## Mehrere Benutzer gleichzeitig

Bis rund 8 Benutzer arbeiten gleichzeitig. Du musst dafür nichts einrichten. Es braucht keinen weiteren Dienst.

- Jeder Benutzer hat eine eigene Sitzung.
- Speichert ein Benutzer ein veraltetes Formular, speichert das Tool nichts. Es zeigt eine Meldung mit dem neuen Stand.
- **Live:** Jede Seite aktualisiert sich selbst. Ändert ein Benutzer etwas, sehen alle anderen es sofort.
  Niemand muss die Seite neu laden.
- Speichern, Eintragen, Bestätigen und Löschen laufen im Hintergrund. Die Seite lädt dabei nicht neu.
- Offene Eingaben bleiben stehen. Das gilt für ein Formular mit Änderungen, das Feld mit dem Cursor, aufgeklappte Bereiche und Suchfelder.
- Oben rechts steht «Live» mit einem grünen Punkt. Bei «Getrennt» (orange) fehlt die Verbindung. Die Seite versucht es selbst weiter.
- Blockieren sich zwei Speichervorgänge in der Datenbank, wiederholt das Tool den Vorgang selbst.
- Ein täglicher Job läuft nie zweimal gleichzeitig.

**Reverse-Proxy (z. B. Nginx Proxy Manager):** Die Live-Meldungen laufen über `GET /live` (Server-Sent Events).
Du musst nichts einstellen. Das Tool sendet den Header `X-Accel-Buffering: no`, damit Nginx nichts zurückhält.
Alle 20 Sekunden sendet das Tool ein Lebenszeichen. So schliesst der Proxy die Verbindung nicht.
Hält ein Proxy die Meldungen trotzdem zurück, fragt die Seite alle 10 Sekunden selbst nach.

**Datenbank:** Das Update auf diese Version ändert die Datenbank (Schema-Version 2).
Das Tool ergänzt beim ersten Start die Spalte `version` in den Tabellen `einsatz`, `schicht` und `anmeldung`.
Das geschieht automatisch. Die Daten bleiben erhalten. Eine ältere Sicherung lässt sich weiter einspielen.
Der nächste Start ergänzt die Spalte dann wieder.

## Sicherung und Wiederherstellung

- Der Tagesexport schreibt jede Nacht `datenbank-JJJJ-MM-TT.sql` nach `export\` und lädt die Datei nach SharePoint.
- Vor jedem Update entsteht eine Sicherung in `export\update-sicherung\`. Das Tool behält die 5 neuesten.

Wiederherstellen (PowerShell als Administrator, `$H` gesetzt):

1. Stoppe den Einsatzplaner: `& "$H\stop.cmd"`
2. Spiel die Sicherung ein. Ersetze `JJJJ-MM-TT` durch das Datum der Sicherung:
   ```powershell
   cd "$H\app"
   $env:ENV_FILE = "$H\einsatzplaner.env"
   node dist\src\wiederherstellen.js "$H\export\datenbank-JJJJ-MM-TT.sql" --bestaetigt
   ```
   Ohne `--bestaetigt` ändert das Skript nichts. Vorher sichert es den aktuellen Stand.
3. Starte den Einsatzplaner wieder: `schtasks /Run /TN Einsatzplaner`

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
