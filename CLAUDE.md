# CLAUDE.md – Einsatzplaner (Aufgebotstool) der Verkehrskadetten

Dieses Dokument hält alle Designentscheide fest. Das Konzept liegt in `docs/Konzept.md`.
Die Entscheide hier gehen dem Konzept vor.

Sprache mit Yann: Deutsch nach ASD-STE100. Aktiv, höchstens 25 Wörter pro Satz, eine Aussage pro Satz.

## 1. Grundanforderungen (kurz, aus Konzept Abschnitt 2 und 5)

- Warnen statt verbieten. Warnungen sind Daten (Code und Text). Sie sperren keine Aktion.
- Clubdesk ist die einzige Quelle für Personendaten. Nur der Import legt Personen an oder ändert sie.
- Ein Einsatz hat mindestens eine Schicht. Beim Erstellen entsteht eine Standardschicht mit `publiziert = 1`.
- Nur die Schicht hat den Schalter «Publiziert».
- Ort, Ort Abtreten, Tenue und Hinweis Aufgebot vererben sich vom Einsatz auf Schichten mit gleichem altem Wert.
- Eine Person hat pro Schicht genau einen Eintrag. Jede Änderung schreibt einen Eintrag ins Statusprotokoll.
- Status: angemeldet, bestätigt, abgemeldet, unsicher, Nachricht gesendet. Kein Eintrag = nicht gefragt.
- Die Bestätigungsmail geht einmal täglich gesammelt, ohne Link. Reply-To ist die Aufgebotsadresse.
- Der Tagesexport schreibt lesbare CSV-Dateien und eine Datenbankkopie und lädt sie nach SharePoint.
- Das Tool löscht nie Daten ohne Bestätigung.
- Ein Einsatz kann bis zu rund 500 Personen haben.

## 2. Entscheide von Yann (gehen dem Konzept vor)

### Arbeitsweise im Code

- Regeln stehen in `src/domain/`. Routen in `src/web/` rufen nur diese Funktionen auf.
- Jede Schreibaktion läuft in einer Transaktion.
- Jede Änderung an einer Anmeldung schreibt in derselben Transaktion einen Eintrag ins Statusprotokoll.
- Jede Eingabe wird auf dem Server geprüft. Jede Ausgabe in HTML wird maskiert.
- Oberfläche, Mails, Datenbanknamen und Kommentare sind Deutsch.
- Neue Abhängigkeiten nur mit gutem Grund. Jede Abhängigkeit ist ein Sicherheitsrisiko.
- Zu jeder Regel aus Abschnitt 23 des Konzepts gibt es einen Test. `npm test` muss bestehen.
- Keine Inline-Skripte und keine Inline-Styles (Content-Security-Policy `default-src 'self'`).

### Technik

- Node.js 22, TypeScript, Express 5, nodemailer, csv-parse, node-ical, openid-client, node:test.
- Serverseitig erzeugtes HTML, eigenes CSS ohne Framework, wenig JavaScript.
- MySQL statt SQLite: `mysql2`, MySQL 8 oder MariaDB 10.6 oder neuer.
  - Zeiten bleiben Text in UTC (`VARCHAR(30)`, ISO-Format). Sortierung `utf8mb4_bin`.
  - Die Tabelle `schema_version` steuert die Migrationen.
  - Die Datenbankkopie im Tagesexport ist eine SQL-Datei `datenbank-JJJJ-MM-TT.sql`. Das Tool schreibt sie selbst, ohne `mysqldump`.
  - Die Tests brauchen einen MySQL- oder MariaDB-Server. Jeder Test legt eine eigene Datenbank an.
  - Konfiguration: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` statt `DB_PATH`.
- Windows und Linux. Keine nativen Module. Pfade laufen über `node:path`.
- Das Tool liest `.env` beim Start selbst (`ENV_FILE`). Umgebungsvariablen haben Vorrang.
- Das Tool beendet sich sauber bei SIGTERM, SIGINT und SIGBREAK.
- Port 3010. Der Server lauscht nur intern. Von aussen geht der Zugriff nur über den Reverse-Proxy mit HTTPS.
- Das Tool vertraut `X-Forwarded-For` nur von Adressen im lokalen oder privaten Netz.
- Ein Server-Prozess. Jobs im Speicher setzen einen Prozess voraus.

### Fachliche Entscheide

- Code im Repo-Wurzelordner, kein Unterordner.
- Keine «E-Mail Alternativ». Nur Adressen mit `@web.kkb.ch` gelten (offener Punkt 9.1).
- Keine Start-Ränge (offener Punkt 9.2). Der Admin legt die Ränge an. Ein neuer Rang kommt ans Ende (tiefster Rang). Kleine Zahl in `reihenfolge` = tiefer Rang.
- Rollen: Der Admin legt Rollen an, ändert Reihenfolge und Teilnehmerzählung und löscht unbenutzte Rollen. Umbenennen geht nicht.
- Eine neue Schicht übernimmt Ort, Ort Abtreten, Tenue und Hinweis vom Einsatz. Eine neue zusätzliche Schicht ist nicht publiziert.
- Namensvergleich im Formular: «ä», «ae» und «a» gelten als gleich (ebenso ö, ü). Akzente zählen nicht.
- E-Mail aus dem Formular: Das Tool speichert sie nur bei unbekannten Personen. Bei bekannten Personen gilt die Clubdesk-Adresse.
- Das Formular speichert Essenseinschränkungen in der Bemerkung mit dem Präfix «Essen: ». Es ändert keine Personendaten.
- Ohne Geburtsdatum keine Alterswarnung. In Anrufliste und Rückmeldungen gilt eine Person ohne Geburtsdatum (bei Mindestalter) oder ohne Rang (bei Mindestrang) als «nicht passend».
- `W_UEBERLAPP` prüft nur den Status des anderen Eintrags (angemeldet oder bestätigt).
- Bestätigung ohne Adresse: ein Log-Eintrag je Änderung. Kommt später eine Adresse, geht die Mail im nächsten Tageslauf weg.
- Spätere Änderungen nach dem Versand lösen keine neue Bestätigungsmail aus. Ein erneuter Wechsel nach «bestätigt» löst eine neue Mail aus. Reply-To ist die Aufgebotsadresse.
- Unbekannte Personen mit gleicher Mail-Adresse erhalten eine gemeinsame Bestätigungsmail.
- Austritt: Das Statusprotokoll bleibt. Beim Löschen der Personendaten leert das Tool Bemerkungen sowie Name oder Mail vor einer Zuordnung.
- Import ohne Bestätigung der Löschung: Das Tool zeigt die Vorschau erneut und ändert nichts.
- Die Upload-Datei des Imports liegt im Ordner `import/` im Datenordner. Das Tool löscht sie nach dem Anwenden, sonst nach einer Stunde.
- Auch die Dankesseite des Formulars darf im iframe von Clubdesk erscheinen.
- Cookie `Secure` nur, wenn `BASE_URL` mit `https://` beginnt.
- Test-Login `DEV_LOGIN=1` nur für lokale Tests: nur ohne `ENTRA_TENANT_ID`, nur mit `NODE_ENV=development`. Der Server lauscht dann nur auf `127.0.0.1`. Nie auf dem Server setzen.
- «Änderung melden» öffnet einen `mailto:`-Link an `MAIL_ROMAN` mit Clubdesk-ID, Name und «Bitte ändern: …».
- Archiv-Zahl: Summe der Teilnehmenden über alle Schichten.
- Kopieren: Die Vorgabe für den Namen erhöht die erste Jahreszahl um eins. Startdatum = derselbe Tag im nächsten Jahr.
- Aufgebot für unbekannte bestätigte Einträge: Brief mit dem Hinweis «Adresse fehlt». Gelöschte Personen erhalten keinen Brief. Fehlt die Einsatzleitung, steht das in den Lücken (`W_EINSATZLEITUNG`).
- Tägliche Jobs prüfen jede Minute die lokale Stunde und laufen einmal pro Tag.

### Update über die Admin-Seite (nicht im Konzept)

- Seite Admin › Update, nur für Admins, nur mit `UPDATE_ERLAUBT=1`, nur per POST mit CSRF-Token und Häkchen.
- Ablauf: prüfen (`git fetch`, neue Commits zeigen, keine lokalen Änderungen), Datenbank sichern, `git merge --ff-only origin/<UPDATE_BRANCH>`, `npm ci`, `npm run build`, Neustart mit Exit-Code 75.
- Ein Fehler nach dem Holen setzt den Code auf den alten Commit zurück. Ohne Sicherung kein Update.
- Das Tool behält die 5 neuesten Sicherungen vor einem Update.
- Befehle und Argumente sind fest im Code. `UPDATE_BRANCH` ist geprüft (keine Sonderzeichen). Git fragt nie interaktiv (`GIT_TERMINAL_PROMPT=0`).
- Die Seite zeigt Schritte und Fehlermeldungen von Git vollständig an. Sie lädt sich während des Updates selbst neu.

### Aussehen und Bedienung

Siehe Abschnitt 3 des Auftrags. Kurz: Seitenleiste dunkelblau, Startseite «Zu tun», Ist/Soll-Farben (grün voll, orange ≥ 80 %, rot weniger), neue Seite «Rückmeldungen», Druckansicht Teilnehmerliste, Anruf- und WhatsApp-Links, heller und dunkler Modus, Systemschrift, alle Seiten handytauglich.

### Betrieb

- Ein Prozess, gestartet durch `start.cmd` in einer Schleife (Neustart nach 3 Sekunden, z. B. nach Exit-Code 75).
- Autostart über die Windows-Aufgabenplanung als `SYSTEM`. Kein NSSM, kein Windows-Dienst.
- Ordner: `C:\einsatzplaner\app`, `\data`, `\export`, `\logs`, Konfiguration `C:\einsatzplaner\einsatzplaner.env`.

## 3. Bewusst weggelassen (mit Begründung)

| Funktion | Begründung |
|---|---|
| Bearbeiten von Personendaten im Tool | Clubdesk ist die einzige Quelle. Zwei Quellen führen zu Widersprüchen. |
| Automatisches Aktualisieren von Clubdesk-Terminen | Es gibt keinen gemeinsamen Schlüssel zwischen Tool und Clubdesk. |
| Status «nicht erreicht» | Eine Person ohne Status ist die Restmenge. Mehr Status verwirren die Nutzer. |
| Weitere Status (Warteliste, Rückfrage, ungültig) | Entscheid Yann. Gleiche Begründung wie oben. |
| Oberfläche zum Bearbeiten der Vorlagen (Aufgebot, Mail, Kalender) | Version 1. Änderungen am Text laufen über einen Commit. |
| Getrennte Publikationsschalter für Einsatz und Schicht | Ein Schalter je Schicht genügt. Der Einsatz ist sichtbar, wenn eine Schicht sichtbar ist. |
| Automatische Zuteilung von Personen zu Schichten | Die Aufgebotsstelle teilt von Hand zu. |
| Erfassung von Telefonkanälen und Erreichbarkeitszeiten | Nicht nötig. Der Kanal je Anmeldung genügt. |
| Zweite Ausbaustufe für weitere Einsatzarten | Das Gespräch beschreibt sie nicht genau. |
| Rolle Einsatzleiter als Benutzerrolle | Entscheid Yann. Nur Admin und Aufgebot. |
| Passwort-Login, Zwei-Faktor-Anmeldung | Login nur über Microsoft Entra. Das Tool speichert keine Passwörter. |
| Anlegen von Personen | Nur der Import legt Personen an. |
| Server-Einstellungen im Browser | Konfiguration nur über die `.env`-Datei. |
| Ausblenden der Essenseinschränkungen nach dem Einsatz | Die Daten kommen aus Clubdesk und bleiben sichtbar. |
| Eigene Handy-App | Kommt später als eigener Auftrag. |

## 4. Annahmen aus dem Konzept

Diese Liste ergänze ich beim Bauen. Jede Annahme aus Teil B des Konzepts steht hier.

- Eine neue zusätzliche Schicht hat `publiziert = 0` (13.2).
- «Änderung melden»: Betreff «Änderung Personendaten» (14.4).
- Formular-Essenseinschränkungen gehen in die Bemerkung (15.2).
- Spätere Änderungen nach dem Versand lösen keine neue Mail aus (18.2).
- Der iCal-Abgleich vergleicht nur Titel und Zeiten (17.4).
- Inaktive Benutzer kommen nicht hinein (22.1).
- Die Datenbankkopie liegt auch auf SharePoint (19.1).

## 5. Neue Entscheide (während des Baus)

- 18.11.2026: Repo ist `Piste3/Einsatztool` (der Auftrag nannte `Piste3/Aufgebotstool`). Yann hat das bestätigt.
- 18.11.2026: Claude baut Code und Tests in einer Cloud-Umgebung. Den Server richtet Yann später ein.
- 18.11.2026: Commits gehen direkt auf `main`.
- 18.11.2026: Die Installation auf dem Server bleibt einfach: Node.js, Datenbank, `.env`, ein Startskript. Keine weiteren Werkzeuge.
- 18.11.2026: Das Tool läuft auf Windows 11 und später auch auf Linux. Es gibt `start.cmd`/`stop.cmd` für Windows und `start.sh`/`stop.sh` für Linux.
