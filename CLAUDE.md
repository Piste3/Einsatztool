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
- Das Formular fragt keine E-Mail (seit 19.11.2026, Wunsch Yann). Die Zuordnung läuft nur über den Namen. Bekannte Personen erhalten Mails an die Clubdesk-Adresse.
- Das Formular fragt keine Essenseinschränkungen (seit 19.11.2026, Wunsch Yann). Sie kommen nur aus den Stammdaten (Clubdesk).
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
- «Änderung melden» öffnet einen `mailto:`-Link an die Informatik (`MAIL_INFORMATIK`). Die Mail ist eine allgemeine Vorlage: Clubdesk-ID, Name und leere Zeilen «Was ändern», «Alt», «Neu», «Weitere Änderungen», «Bemerkung».
- Archiv-Zahl: Summe der Teilnehmenden über alle Schichten.
- Kopieren: Die Vorgabe für den Namen erhöht die erste Jahreszahl um eins. Startdatum = derselbe Tag im nächsten Jahr.
- Aufgebot für unbekannte bestätigte Einträge: Brief mit dem Hinweis «Adresse fehlt». Gelöschte Personen erhalten keinen Brief. Fehlt die Einsatzleitung, steht das in den Lücken (`W_EINSATZLEITUNG`).
- Tägliche Jobs prüfen jede Minute die lokale Stunde und laufen einmal pro Tag.

### Update über die Admin-Seite (nicht im Konzept)

- Seite Admin › Update, nur für Admins, nur mit `UPDATE_ERLAUBT=1`, nur per POST mit CSRF-Token. Seit 19.11.2026 (Wunsch Yann): genau zwei Knöpfe oben, «Nach Updates suchen» und «Update installieren» (Rückfrage im Browser statt Häkchen).
- Ablauf von «Update installieren»: prüfen (`git fetch`, neue Commits, keine lokalen Änderungen), Datenbank und `einsatzplaner.env` sichern, `git merge --ff-only origin/<UPDATE_BRANCH>`, `npm ci`, `npm run build`, Neustart mit Exit-Code 75.
- Ein Fehler nach dem Holen setzt den Code auf den alten Commit zurück. Ohne Sicherung kein Update.
- Das Tool behält die 5 neuesten Sicherungen vor einem Update.
- Befehle und Argumente sind fest im Code. `UPDATE_BRANCH` ist geprüft (keine Sonderzeichen). Git fragt nie interaktiv (`GIT_TERMINAL_PROMPT=0`).
- Die Seite zeigt je Schritt eine Zeile mit ✓ oder ✗. Die Ausgabe ist eingeklappt, bei einem Fehler offen. Sie lädt sich während des Updates selbst neu.

### Aussehen und Bedienung

Siehe Abschnitt 3 des Auftrags. Kurz: Startseite «Cockpit» mit «Zu tun», Ist/Soll-Farben (grün voll, orange ≥ 80 %, rot weniger), neue Seite «Rückmeldungen», Druckansicht Teilnehmerliste, Anruf- und WhatsApp-Links, heller und dunkler Modus, Systemschrift, alle Seiten handytauglich.

Seit 19.11.2026 (Entscheid Yann): Aussehen und Bedienung folgen dem Handbuch des KKB-Einsatzplaners (nur als Vorbild). Funktionen bleiben gleich. Kein fremdes Logo.

- Logo: das KKB-Logo (`src/web/public/logo.png`, auch als `favicon.png`) auf weisser Fläche, damit es im dunklen Modus sichtbar bleibt. Untertitel «Kadetten-Korps Basel». Das öffentliche Formular bleibt ohne Logo.

- Helle Navigation links mit Symbolen, unten Benutzer, Darstellung (wie System, Hell, Dunkel) und Abmelden.
- Jede Seite: Pfad, Titel, Angaben, rechts «Live» und Knöpfe (der wichtigste dunkel), darunter Reiter. Baustein `seitenKopf()` in `src/web/views/layout.ts`.
- Seltene Aktionen liegen im Menü «Mehr ▾» (`mehrMenue()`, `<details>`, geht ohne Skript).
- Einsatz-Reiter (seit 19.11.2026, Vorlage Yann): «Übersicht», «Anmeldungen», «Schichten», «Verlauf». Die Schichtseite zeigt die Schichten des Einsatzes als Chips.
- Status als Pille mit farbigem Punkt: angemeldet blau, bestätigt grün, unsicher orange, Nachricht gesendet violett, abgemeldet grau.
- Die Wahl der Darstellung speichert der Browser (`localStorage`). `thema.js` setzt sie vor dem Zeichnen.
- CSS und Skripte haben `?v=<Startzeit>`. Nach einem Update lädt der Browser die neuen Dateien.

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
| Ausblenden der Essenseinschränkungen nach dem Einsatz | Die Daten kommen aus Clubdesk und bleiben sichtbar. |
| Eigene Handy-App | Kommt später als eigener Auftrag. |

## 4. Annahmen aus dem Konzept

Diese Liste ergänze ich beim Bauen. Jede Annahme aus Teil B des Konzepts steht hier.

- Eine neue zusätzliche Schicht hat `publiziert = 0` (13.2).
- «Änderung melden»: Betreff «Änderung Personendaten: Name (Clubdesk-ID n)» (14.4).
- Formular-Essenseinschränkungen gingen in die Bemerkung (15.2). Ersetzt am 19.11.2026: Das Formular fragt nicht mehr danach.
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
- 18.11.2026: `LISTEN_HOST` steuert die Adresse, auf der der Server lauscht. Standard `127.0.0.1`.
- 18.11.2026: Die Tabelle `job_lauf` hält fest, wann ein täglicher Job gelaufen ist. So läuft jeder Job einmal pro Tag, auch nach einem Neustart.
- 18.11.2026: `mail_queue.naechster_versuch`: Ein Fehler beim Versand führt zu einem neuen Versuch später, nicht sofort.
- 18.11.2026: Einträge mit «abgemeldet» erhalten keine Warnungen.
- 18.11.2026: Formular: Ein zweiter unbekannter Eintrag mit gleichem Namen und gleicher Mail in derselben Schicht ergänzt die Bemerkung des ersten. Es entsteht kein zweiter Eintrag.
- 18.11.2026: Rückmeldungen: «An» = angemeldet + bestätigt. «Offen» = passende Person ohne Eintrag oder mit «Nachricht gesendet».
- 18.11.2026: Beim Löschen der Personendaten leert das Tool im Statusprotokoll auch die Werte der Aktionen `bemerkung` und `zugeordnet`.
- 18.11.2026: Die letzte Schicht eines Einsatzes lässt sich nicht löschen. Der Admin löscht dann den Einsatz.
- 18.11.2026: Ein ungültiges Geburtsdatum im Import ergibt einen Hinweis in der Vorschau und ein leeres Feld.
- 18.11.2026: «Offen – nicht gefragt» auf der Personenseite zeigt auch unpublizierte Schichten. Die Aufgebotsstelle darf dort eintragen.
- 18.11.2026: Wiederherstellen über `node dist/src/wiederherstellen.js <datei> --bestaetigt`. Ohne `--bestaetigt` ändert das Skript nichts. Vorher sichert es den aktuellen Stand.
- 18.11.2026: Stoppen über die Stopp-Datei `stop.flag` (Variable `STOP_DATEI`). Grund: Ein Prozess unter `SYSTEM` ohne Konsole erhält kein Signal. Erst nach 20 Sekunden beendet `stop.cmd` den Node-Prozess auf dem Port.
- 18.11.2026: `start.cmd` und `stop.cmd` liegen im Repo unter `betrieb/windows/` und werden nach `C:\einsatzplaner\` kopiert. Grund: Ein Update ändert `app`, ein laufendes Batch-Skript darf sich nicht ändern.
- 18.11.2026: Die Aufgabe in der Aufgabenplanung entsteht mit `aufgabe-einrichten.ps1`. `schtasks` allein kann das Zeitlimit nicht ausschalten.
- 18.11.2026: Die Log-Datei heisst `logs\einsatzplaner-JJJJ-MM-TT.log`. Das Datum ist der Tag des Starts von Node.
- 19.11.2026: Bis rund 8 Benutzer arbeiten gleichzeitig. Kein weiterer Dienst (kein Redis).
- 19.11.2026: Spalte `version` in `einsatz`, `schicht`, `anmeldung` (Migration 2). Ein Formular mit alter Version speichert nichts und zeigt eine Meldung (`Konflikt`). Ohne Version im Formular prüft das Tool nichts (z. B. Knopf «Bestätigen», Sammelstatus).
- 19.11.2026: Nach einem Konflikt im Formular «Bearbeiten» bleiben die Eingaben stehen. Ein zweites Speichern überschreibt bewusst.
- 19.11.2026: Ändert der Einsatz einen vererbten Wert, steigt auch die Version der betroffenen Schichten.
- 19.11.2026 (ersetzt den Hinweis «Neu laden»): Live-Aktualisierung auf allen Seiten (Wunsch Yann). Jede abgeschlossene Transaktion erhöht einen Zähler im Speicher (`src/db/aenderungen.ts`). `GET /live` (Server-Sent Events) meldet ihn allen angemeldeten Seiten. Puls alle 20 Sekunden, Header `X-Accel-Buffering: no`.
- 19.11.2026: Bei einer Meldung holt die Seite sich selbst im Hintergrund (Header `X-Live-Abfrage: 1`) und tauscht Navigation und Inhalt aus. Formulare mit Änderungen, das Feld mit dem Cursor, offene `<details>` und Suchfelder bleiben stehen. Ein geschütztes Formular behält seine alte Version. Der Konfliktschutz greift beim Speichern.
- 19.11.2026: POST-Formulare senden im Hintergrund (`fetch`). Nach einer Weiterleitung auf eine andere Seite ändert das Skript die Adresse (`history.pushState`). `data-normal` schaltet das ab (Abmelden, Neustart). Admin › Update hat `ohneLive` (Header «Refresh»).
- 19.11.2026: Live-Abfragen und Hintergrund-Abfragen verlängern die Sitzung nicht und holen keine Meldung («Gespeichert») ab. Ohne Event-Stream fragt die Seite alle 10 Sekunden `GET /live/stand` ab. Ohne Skript funktioniert jede Seite wie bisher.
- 19.11.2026: `transaktion()` wiederholt einen Vorgang bei Deadlock oder Sperr-Wartezeit (höchstens 4 Versuche). Gleichzeitiges Anlegen desselben Eintrags führt zu einer Wiederholung statt zu einem Fehler.
- 19.11.2026: Verbindungspool 20 Verbindungen. Ein täglicher Job läuft nie zweimal gleichzeitig (Sperre im Speicher).
- 19.11.2026: Das Update ruft `npm ci --include=dev` auf. Grund: `start.cmd` setzt `NODE_ENV=production`. Ohne `--include=dev` fehlt TypeScript (`tsc`) beim Bauen.
- 19.11.2026: Oberfläche nach dem Handbuch des KKB-Einsatzplaners umgestaltet (siehe «Aussehen und Bedienung»). Regeln, Routen und Daten sind unverändert.
- 19.11.2026: Admin › Konfiguration zeigt und ändert alle Werte der `.env`-Datei (Wunsch Yann). Die Seite schreibt direkt in `ENV_FILE`. Grund: eine einzige Quelle, und bei einem falschen Wert hilft die Datei auf dem Server.
- 19.11.2026: Änderungen an der Konfiguration wirken nach einem Neustart (Knopf «Neu starten», Exit-Code 75). Der alte Stand bleibt als `.vorher`.
- 19.11.2026: Geheimnisse gehen nie an den Browser. Leeres Feld = unverändert. Das Protokoll `konfiguration_protokoll` (Migration 3) zeigt Geheimnisse nur als «(gesetzt)» oder «(leer)».
- 19.11.2026: Werte aus echten Umgebungsvariablen sind auf der Seite gesperrt. `NODE_ENV` und `DEV_LOGIN` erscheinen nicht auf der Seite.
- 19.11.2026: Neue Datenbank-Werte prüft das Tool vor dem Speichern. Ohne Verbindung speichert es nur mit «Trotzdem speichern» (Warnen statt verbieten).
- 19.11.2026: Konfliktschutz über eine Prüfsumme der Datei. Ein Formular mit altem Stand speichert nichts.
- 19.11.2026: `MAIL_ROMAN` heisst neu `MAIL_INFORMATIK` (Wunsch Yann: Die Adresse gehört der Informatik, nicht einer Person). Der alte Name gilt beim Lesen weiter. Beim Speichern über Admin › Konfiguration erhält die Zeile den neuen Namen.
- 19.11.2026: Meldungen nach einer Aktion («Gespeichert», Fehler) erscheinen als Toast unten rechts (`toast()` in `layout.ts`). Sie verschieben das Layout nicht. ok verschwindet nach 3 s, Hinweis nach 6 s, Fehler bleibt bis «×». Fehler bei der Eingabe in einem Formular bleiben direkt beim Formular.
- 19.11.2026: Rückmeldungen: Ein Klick auf ein Feld öffnet ein Fenster zum Eintragen (Status, Kanal, Rolle, Bemerkung), wie im Handbuch des KKB-Einsatzplaners. `GET /rueckmeldungen/eintrag` liefert das Fenster. Speichern läuft über die bestehenden Routen mit Version (Konfliktschutz). Ohne Skript öffnet der Klick eine eigene Seite.
- 19.11.2026 (Wunsch Yann): Im Fenster der Rückmeldungen lässt sich nicht bestätigen. «bestätigt» erscheint dort nur bei einem schon bestätigten Eintrag. Bestätigen geht in der Schicht.
- 19.11.2026 (Vorlage Yann): Rückmeldungen zeigen Kacheln mit Symbol statt Punkten. Farben dort: An dunkelgrün, Bestätigt grün, Ab rot, Nachricht gesendet blau, Unsicher orange, Offen gestrichelt. Die Pillen auf den anderen Seiten bleiben gleich.
- 19.11.2026: Der Kopf der Rückmeldungen fasst die Schichten eines Einsatzes zusammen (Datum, Einsatz, Schicht, Balken Ist / Soll). Ein leeres Feld zeigt «Andere Schicht, gleiche Zeit» oder «zeitlich möglich», wenn die Person in einer anderen Schicht desselben Einsatzes an ist. Das ist nur eine Anzeige, kein Status.
- 19.11.2026 (Wunsch Yann): Bemerkung bei der Anmeldung. Die Person gibt sie im Formular ein. Die Aufgebotsstelle sieht und bearbeitet sie in der Schicht und im Fenster der Rückmeldungen, auch beim Eintragen. Ein Feld mit Bemerkung zeigt in den Rückmeldungen die Marke ✎ und die Bemerkung im Titel. Eintragen mit leerer Bemerkung lässt eine vorhandene Bemerkung stehen (Test T30).
- 19.11.2026 (Wunsch Yann): Formular ohne E-Mail und ohne Essenseinschränkungen. Jeder Einsatz hat ein eigenes Feld «Bemerkungen» (`bemerkung_<Einsatz-ID>`), ohne Untertitel. Es gilt für alle gewählten Schichten dieses Einsatzes. Unbekannte Personen haben dann keine Adresse und erhalten keine Bestätigungsmail (Test T31).
- 19.11.2026 (Konzept Yann, Mockup `einsatzansicht/konzept-einsatzansicht.html` im Projektordner): Neue Einsatz-Übersicht. Steckbrief (Antreten, Abtreten, Tenue, Einsatzleitung, Hinweis), Liste «Zu tun» statt Lage-Leiste, Schichten als Tabelle mit Balken (bestätigt und angemeldet), Personen mit Kacheln und Fenster wie in den Rückmeldungen. Bei genau einer Schicht zeigt die Seite eine Liste statt Matrix. Regeln und Routen sind unverändert (Test T32).
- 19.11.2026: «Zu tun» berechnet `einsatzLage()` in `src/domain/einsatz-lage.ts`. Ohne Soll meldet die Liste «Kein Soll festgelegt» und nie «besetzt». Nullen erscheinen nicht. Nur kommende Schichten zählen.
- 19.11.2026: Einsatzleitung im Steckbrief = Einträge (angemeldet oder bestätigt) mit der Rolle «Einsatzleitung». Gibt es die Rolle nicht, fehlt die Angabe und die Zeile in «Zu tun».
- 19.11.2026: Filter der Personen auf der Einsatz-Übersicht: `?personen=offen` (angemeldet, unsicher, Nachricht gesendet) und `?personen=warnung`.
- 19.11.2026 (Vorlage Yann, Handbuch Bild 6): Einsatz-Liste mit Datum, Einsatz, Antreten (Beginn und Ort der ersten Schicht), Status («Im Formular» = mindestens eine Schicht publiziert, sonst «Entwurf»), Besetzung je Schicht mit Balken (eine Schicht = «Ganzer Einsatz»), Neu (angemeldet), Bestätigt und Einsatzleitung. Filter Status, von, bis (Server) und Suche (im Browser). Test T33.
- 19.11.2026 (Vorlage Yann, Handbuch): Einsatz-Seite mit Reitern Übersicht, Anmeldungen (`/einsaetze/:id/anmeldungen`), Schichten (`/einsaetze/:id/schichten`), Verlauf (`/einsaetze/:id/verlauf`). Kopf: Datum, Antreten (Zeit und Ort), Leitung. Alte Links `/einsaetze/:id?personen=…` leiten auf «Anmeldungen» um.
- 19.11.2026: Reiter «Schichten»: Karten je Schicht (Besetzung, Rollen, angemeldete und bestätigte Personen, sonst «Noch niemand zugeteilt.») und Tabelle «Schichten bearbeiten». Die Tabelle ändert Name, Datum, Beginn, Ende, Bedarf je Rolle, Soll, Antretensort und interne Bemerkung mehrerer Schichten in einer Transaktion (`speichereSchichtTabelle()`). Die unterste Zeile legt eine neue Schicht an (nicht publiziert). Test T34.
- 19.11.2026: Tabelle: Ende vor Beginn = Ende am Folgetag. Schichten über mehr als den Folgetag zeigt die Tabelle nur lesend mit Link zum Formular. Eine Zeile ohne Änderung (Fingerabdruck `ursprung`) schreibt nichts. Eine geänderte Zeile mit alter Version speichert nichts (Konflikt).
- 19.11.2026: Unterschied zum Handbuch: Soll ist ein eigenes Feld und nicht die Summe der Rollen. Rollen kommen aus Admin › Einstellungen, nicht fest EL/SC/BF/TN. Reiter «Anfragen» und «Formular» gibt es nicht (keine Funktion dafür).
- 19.11.2026 (Wunsch Yann): Neuer Einsatz: nur Name und Startdatum sind Pflicht (Entscheid Yann: Name bleibt Pflicht). Enddatum leer = gleicher Tag. Ohne Enddatum und mit Ende vor Beginn = Folgetag. Formular in zwei Spalten: links die Daten, rechts die Zeiten.
- 19.11.2026: Zeiten leer = «Zeit offen». Spalte `schicht.zeit_offen` (Migration 4). Das Tool speichert 00:00 bzw. 23:59 und zeigt «Zeit offen». «Zu tun» meldet die fehlenden Zeiten. Speichern mit Zeiten (Formular der Schicht oder Tabelle) setzt `zeit_offen = 0`. Test T35.
