# Konzept (Stand 18.11.2026)

Text aus Anhang A des Auftrags, unverändert. Die Entscheide in `CLAUDE.md` gehen diesem Text vor, vor allem bei Datenbank (MySQL statt SQLite) und Betrieb.

```text
Konzept: Einsatzplanungs-Tool der Verkehrskadetten

Konzept: Einsatzplanungs-Tool der
Verkehrskadetten
Quelle: Arbeitssitzung vom 17.11.2026 (Transkript, 120 Minuten). Stand: 18.11.2026. Das
Transkript ist maschinell erstellt und teilweise fehlerhaft. Unklare Stellen sind mit „Offen“
markiert.

1. Ziel und Ausgangslage
Ziel. Das Tool ersetzt Forms und Excel für Einsätze, Schichten und Anmeldungen.
Clubdesk bleibt die einzige Quelle für Personendaten.

Heutiger Ablauf.

       Eine Anfrage kommt per E-Mail. Die Aufgebotsstelle entscheidet, ob sie die Anfrage
       annimmt.
       Bei Annahme legt sie den Einsatzordner an (SharePoint und Outlook). Sie erstellt die
       Offerte aus einer Excel-Vorlage und einem Clubdesk-Deckblatt.
       Danach legt sie einen Forms-Eintrag, einen Excel-Eintrag und einen Clubdesk-Termin
       an.
       Bei jeder Anmeldung trägt sie die Person von Hand in Excel und Clubdesk ein.
       Dann erstellt sie das Aufgebot aus einer Clubdesk-Vorlage und versendet es.

Probleme.

       Die Aufgebotsstelle vergisst Einträge.
       Tippfehler in Forms führen zu Fehlern.
       Ein Einsatz mit mehreren Schichten ist heute mehrere getrennte Einsätze. Dadurch
       fehlt der Überblick.
       Personen stehen unbemerkt in zwei Schichten gleichzeitig.
       Neue Aspirantinnen fehlen in der Personentabelle. Ihre Essenseinschränkungen
       fehlen dann. An der Herbstmesse gab es deshalb falsche Lunchpakete.

2. Leitprinzipien
   1. Warnen statt verbieten. Das Tool zeigt Warnungen. Es sperrt keine Aktion, ausser bei
      technisch unmöglichen Fällen.
   2. Eine Quelle für Personendaten. Das Tool ändert keine Personendaten. Es liest sie aus
       Clubdesk.
   3. Sauberes Datenmodell. Das Datenbankschema muss von Anfang an stimmen.
      Spätere Änderungen sind teuer.
   4. Ausfallsicherheit. Bei einem Ausfall muss eine nicht technische Person an die
       Rohdaten kommen.
   5. Grösse. Ein Einsatz kann bis zu rund 500 Personen haben. Das Tool darf bei dieser
      Zahl nicht an Grenzen stossen.

3. Rollen
       Aufgebotsstelle: verwaltet Einsätze, Schichten und Anmeldungen.
       Admin: verwaltet zusätzlich die Stammdaten und den Import.

Login und Rollen: Das Tool meldet Benutzer über Microsoft Entra ID an (Abschnitt 22.1).
Die Entra-App-Rollen Admin und Aufgebot bestimmen die Berechtigung.

4. Datenmodell

Einsatz
Der Einsatz ist die Übereinheit. Er hat mindestens eine Schicht.

  Feld                                 Beschreibung

  Name                                 z. B. „Herbstmesse“

  Ort                                  wird auf die Schichten vererbt

  Bemerkung intern                     nur für die Aufgebotsstelle

  Bemerkung extern                     sichtbar für Personen im Formular

Schicht
Standard: Jeder Einsatz hat genau eine Schicht über den ganzen Einsatz.

  Feld                                               Beschreibung

  Name                                               z. B. „Nachtschicht“, „Sektor Blau“

  Startzeit, Endzeit                                 das Datum leitet sich daraus ab

  Ort                                                erbt vom Einsatz, kann pro Schicht abweichen

  Mindestalter                                       optional
  Feld                                               Beschreibung

  Mindestrang                                        optional

  Benötigte Rollen                                   z. B. Einsatzleitung, Busfahrer, je mit Anzahl

  Soll-Anzahl TN                                     optional, nur ein Zielwert. Es gibt keine
                                                     Obergrenze und keine Warnung bei
                                                     Überschreitung

  Bemerkung intern, extern                           wie beim Einsatz

  Publiziert                                         ja oder nein, pro Schicht

Person
Das Tool importiert Personen aus Clubdesk. Die Clubdesk-ID ist der Schlüssel.

  Feld                                          Beschreibung

  Clubdesk-ID                                   numerischer Schlüssel aus dem Export

  Name                                          Vorname und Nachname

  Alter                                         für Regeln wie 16+ und 18+

  Rang                                          für den Mindestrang

  Telefon, E-Mail                               für Anrufe und Mails

  Essenseinschränkungen                         für die Essensliste

Offen: Die genaue Feldliste ist nicht fix. Das Gespräch nannte sicher den Namen und das
Alter.

Anmeldung
Eine Person hat pro Schicht genau einen Eintrag.

  Feld                           Beschreibung

  Person, Schicht                zusammen eindeutig

  Status                         siehe Abschnitt 5.4

  Rolle                          z. B. Busfahrer, Einsatzleitung

  Kanal                          Formular, Telefon, WhatsApp oder mündlich
  Feld                           Beschreibung

  Bemerkung                      ein Feld für Bemerkungen der Person und der
                                 Aufgebotsstelle

Statusprotokoll
Bei jeder Änderung einer Anmeldung speichert das Tool einen Eintrag. Der Eintrag enthält
Zeit, Änderung und Benutzer.

Fremdabteilungen
Eine Zusatztabelle pro Schicht. Sie enthält die Anzahl externer Personen und deren
Essenseinschränkungen.

5. Funktionale Anforderungen

5.1 Einsätze und Schichten
   1. Die Aufgebotsstelle erstellt einen Einsatz mit Name, Start und Ende. Das Tool legt
       automatisch eine Standardschicht an.
   2. Die Aufgebotsstelle kann weitere Schichten zu einem Einsatz hinzufügen. Beispiele:
      Tag- und Nachtschicht, zwei Schichten pro Tag, Sektoren beim slowUp.
   3. Das Tool zeigt alle Schichten eines Einsatzes in einer Ansicht. Es zeigt dort, wer in
       welcher Schicht ist.
   4. Das Tool warnt, wenn eine Person in zwei gleichzeitigen Schichten steht.
       Aufeinanderfolgende Schichten sind erlaubt.
   5. Die Schicht kann ein Mindestalter und einen Mindestrang haben. Das Tool warnt bei
       Verstössen. Es verbietet nichts.
   6. Die Schicht nennt die benötigten Rollen mit Anzahl. Eine Person mit Rolle zählt für
       diese Rolle.
   7. Der Ort wird vom Einsatz auf alle Schichten vererbt. Die Aufgebotsstelle kann den Ort
       pro Schicht überschreiben.
   8. Ändert die Aufgebotsstelle den Ort im Einsatz, gilt das für alle Schichten mit dem
       gleichen Wert. Abweichende Schichten bleiben unverändert.
   9. Der Einsatz und jede Schicht haben eine interne und eine externe Bemerkung.
 10. Die Aufgebotsstelle kann einen Einsatz des Vorjahres kopieren. Diese Funktion ist
       wichtig, weil sie den grössten Teil der Arbeit spart.
5.2 Publizieren
   1. Nur die Schicht hat einen Schalter „Publiziert“. Der Einsatz hat keinen. Ein Einsatz ist
       für Personen sichtbar, wenn mindestens eine seiner Schichten sichtbar ist.
   2. Ein Einsatz mit vielen internen Schichten (z. B. slowUp mit Sektoren) bekommt eine
       publizierte Schicht „Anmeldung“. Sie dient als Sammelbecken. Die Sektor-Schichten
       bleiben unpubliziert.
   3. Die Aufgebotsstelle teilt die Personen später den Sektor-Schichten zu.
   4. Der Einsatz erscheint ohne Zwischenschritt im Anmeldeformular auf der Webseite für
       Personen. Forms entfällt.

5.3 Anmeldung
   1. Personen melden sich über das Anmeldeformular an. Die Anmeldung erscheint sofort
       im Tool.
   2. Die Aufgebotsstelle kann Anmeldungen von Hand erfassen. Sie wählt den Kanal:
      Telefon, WhatsApp oder mündlich.
   3. Das Tool speichert den Kanal bei jeder Anmeldung.
   4. Die Aufgebotsstelle bestätigt eine Anmeldung mit einem Klick.
   5. Die Bestätigung löst eine Bestätigungsmail aus (siehe 5.5). Die Mail verhindert Streit
       über Anmeldungen, die eine Person nicht gemacht haben will.
   6. Die Aufgebotsstelle darf Anmeldungen unbestätigt lassen, z. B. wenn der Einsatz voll
       ist. Sie kann der Person eine Absage senden.
   7. Die Aufgebotsstelle kann Anmeldungen bei der Bestätigung auf eine Schicht und
       Rolle setzen.

Entschieden: Das Tool legt keine Personen an. Die Aufgebotsstelle ordnet unbekannte
Anmeldungen von Hand zu (Abschnitt 14.6).

5.4 Status

  Status                                 Bedeutung

  angemeldet                             Person hat sich angemeldet, noch nicht bestätigt

  bestätigt                              Aufgebotsstelle hat bestätigt. Die Mail geht im
                                         Tagesversand.

  abgemeldet                             Person nimmt nicht teil

  unsicher                               Person weiss es noch nicht. Die Bemerkung enthält
                                         z. B. „Antwort bis Freitag“. Ersetzt „Vielleicht“.
  Status                                 Bedeutung

  Nachricht gesendet                     Die Aufgebotsstelle hat der Person geschrieben
                                         und wartet auf Antwort

  leer                                   Person wurde nicht gefragt oder nicht erreicht

Begründung: Die Aufgebotsstelle muss nach einer Nachricht an alle prüfen können, wer
noch nicht geantwortet hat. Der Status „nicht erreicht“ entfällt bewusst. Eine Person ohne
Status ist die Restmenge. Mehr Status verwirren die Nutzer.

5.5 Bestätigungsmail
   1. Das Tool versendet die Mail einmal täglich, gesammelt (Abschnitt 18.2).
   2. Die Mail nennt alle neu bestätigten Schichten der Person mit Einsatz, Datum, Zeit, Ort
       und Rolle.
   3. Die Mail enthält keinen Link.
   4. Absender ist die Aufgebotsadresse. Antworten gehen an die Aufgebotsadresse. Es
       gibt keine „No-Reply“-Adresse.

Entschieden: Das Tool versendet einmal täglich eine gesammelte Mail ohne Link.

5.6 Statusprotokoll
   1. Bei jeder Änderung legt das Tool einen Protokolleintrag an. Er enthält Zeit, Änderung
       und Benutzer.
   2. Die Aufgebotsstelle sieht daraus, wer wann welche Person angefragt hat.
   3. Das Protokoll entsteht automatisch. Niemand tippt es von Hand.

5.7 Personendaten
   1. Das Tool bearbeitet keine Personendaten.
   2. Ein Admin importiert die komplette Clubdesk-CSV. Der Import ersetzt alle
       Personendaten.
   3. Vor dem Import zeigt das Tool eine Vorschau der Änderungen.
   4. Der Import ordnet Personen über die Clubdesk-ID zu. Alle Anmeldungen bleiben
       dadurch erhalten.
   5. Die Vorschau zeigt oben alle Personen, die in der CSV fehlen (Austritte). Fehlen
      unerwartet viele (z. B. 20), stimmt die CSV wahrscheinlich nicht.
   6. Eine Person mit künftigen Einsätzen löscht das Tool nicht. Es warnt und verlangt
       zuerst, dass die Aufgebotsstelle die Person aus den Einsätzen austrägt.
   7. Bei einer Person ohne künftige Einsätze löscht das Tool nach Rückfrage die
       Personendaten. Die ID und ihre vergangenen Einsätze bleiben im Archiv.
   8. Ändert sich ein Wert (Telefon, Essenseinschränkung), geht die Änderung an Roman in
       Clubdesk. Das Tool erzeugt dafür eine vorbereitete Mail mit der Clubdesk-ID im Text.

Offen: Die Änderung dauert bis zum nächsten Import (bis zu zwei Wochen). Entschieden:
Das Tool löscht die Personendaten nach Rückfrage und behält die ID.

5.8 Clubdesk-Termine
   1. Das Tool exportiert einen Termin beim Erstellen als iCal-Datei (ICS). Die
       Aufgebotsstelle importiert die Datei in Clubdesk.
   2. Das Tool zeigt den Text für den Termin an. Die Aufgebotsstelle kopiert ihn mit einem
       Klick.
   3. Der Export gilt nur für das Erstellen. Das Tool aktualisiert keine bestehenden Termine,
       weil es keinen gemeinsamen Schlüssel gibt.
   4. Bei einem zweiten Export zeigt das Tool eine Warnung wegen Duplikaten.
   5. Das Tool liest den iCal-Feed von Clubdesk. Der Feed aktualisiert sich ungefähr alle 15
       Minuten.
   6. Pro Schicht zeigt das Tool den Abgleich: Termin gefunden, nicht gefunden oder Zeiten
       weichen ab. Eine Markierung weist auf Abweichungen hin.

5.9 Aufgebot
   1. In Version 1 liegt die Aufgebotsvorlage fest im Code. Änderungen am Text laufen über
       einen Commit.
   2. Variable Felder (z. B. Ort, Zeit, Name) füllt das Tool automatisch.
   3. Eine Vorlage mit Platzhaltern für die Aufgebotsstelle ist eine mögliche Erweiterung.

Offen: Das Aufgebot ist ein Brief je Person (Abschnitt 20). Offen ist nur, ob die
Aufgebotsstelle ihn druckt oder per Mail versendet.

5.10 Verpflegung
   1. Das Tool zeigt pro Schicht die Essenseinschränkungen aller angemeldeten Personen.
   2. Die Aufgebotsstelle exportiert die Liste der Essenseinschränkungen.
   3. Eine Schicht kann mehrere Fremdabteilungen haben. Jede hat einen Namen, eine
       Anzahl und ein Bemerkungsfeld (z. B. für Essenseinschränkungen).
       Fremdabteilungen zählen als Teilnehmer (TN) und beim Essen.
   4. Sektorchefs zählen nicht zu den Teilnehmenden. Sonderfälle stehen in den
       Bemerkungen.
6. Nicht funktionale Anforderungen
       Datenbank: SQLite.
       Hosting: Alex betreibt den Server. Zwei parallele Nodes wurden als Idee genannt,
       aber nicht entschieden.
       Tagesexport: Das Tool exportiert täglich alle Daten in einem menschenlesbaren
       Format (CSV oder Excel). Der Export geht in einen SharePoint-Ordner. Damit kann
       eine nicht technische Person (z. B. Noah) bei einem Ausfall weiterarbeiten.
       Datenschutz: Ein Export enthält Personendaten. Die CSV-Dateien werden täglich
       überschrieben. Datenbank-Backups bleiben 14 Tage.
       Sicherheit: Das Tool braucht wenige externe Abhängigkeiten, weil jede ein
       Sicherheitsrisiko ist.
       Dokumentation: Der Code enthält die Funktionsbeschreibung. Eine separate Datei
       CLAUDE.md enthält die Designentscheide in zwei Klassen: Grundanforderungen und
       bewusst weggelassene Funktionen mit Begründung.

7. Soll-Ablauf
   1. Eine Anfrage kommt per E-Mail. Die Aufgebotsstelle entscheidet.
   2. Die Aufgebotsstelle legt im Tool den Einsatz an (Name, Start, Ende). Sie fügt bei
       Bedarf Schichten, Rollen und Bemerkungen hinzu.
   3. Die Aufgebotsstelle exportiert den Termin als ICS und importiert ihn in Clubdesk.
   4. Die Aufgebotsstelle publiziert die Schicht. Sie erscheint im Anmeldeformular.
   5. Personen melden sich an. Die Aufgebotsstelle trägt Anmeldungen per Telefon oder
      WhatsApp selbst ein.
   6. Die Aufgebotsstelle prüft die Warnungen und bestätigt die Anmeldungen. Das Tool
       versendet die Bestätigungsmails.
   7. Die Aufgebotsstelle ruft Personen an oder schreibt ihnen, wenn Personen fehlen. Das
       Tool protokolliert die Status.
   8. Die Aufgebotsstelle erstellt das Aufgebot und die Essensliste.
   9. Nach dem Einsatz bleibt der Einsatz im Archiv.

Offen: Der SharePoint-Ordner, die Offerte und das Outlook-Postfach bleiben im Gespräch
ausserhalb des Tools. Das ist nicht ausdrücklich entschieden.

8. Bewusst weggelassen (Version 1)
       Bearbeiten von Personendaten im Tool.
       Automatisches Aktualisieren von Clubdesk-Terminen.
       Status „nicht erreicht“.
       Oberfläche zum Bearbeiten der Aufgebotsvorlage.
       Getrennte Publikationsschalter für Einsatz und Schicht-Anmeldung als zwei
       Funktionen.
       Automatische Zuteilung von Personen zu Schichten.
       Eigene Erfassung von Telefonkanälen und Erreichbarkeitszeiten.
       Eine zweite Ausbaustufe für weitere Einsatzarten. Das Gespräch beschreibt sie nicht
       genau.

9. Offene Punkte
Noch offen:

   1. Der Auftraggeber prüft die Spaltenliste in Abschnitt 16.1. Besonders: Soll bei leerer E-
       Mail die E-Mail Alternativ gelten?
   2. Der Auftraggeber nennt die Ränge und ihre Reihenfolge. Der Admin legt sie in den
       Einstellungen an (14.5). Der Export enthält diese Ränge: Hptm, Fw, Lt, Adj-Uof, Wm,
       Oblt, Major, KS, Kadett, Kadett mbA, Asp, Asp mbA.
   3. Wer registriert die App in Entra und gibt Sites.Selected für die SharePoint-Site
      frei?
   4. Erlaubt der Exchange-Server den SMTP-Versand über die Aufgebotsadresse?

Entschieden am 18.11.2026:

       Nur der Import legt Personen an oder ändert sie. Die Aufgebotsstelle ordnet
       unbekannte Anmeldungen von Hand zu (14.6).
       Fehlt eine Person im nächsten Gesamtimport, löscht das Tool nach Rückfrage die
       Personendaten. Die ID bleibt. Bei künftigen Anmeldungen muss die Aufgebotsstelle
       die Person zuerst austragen (16.2, 16.3).
       Die lesbaren CSV-Dateien liegen nur aktuell vor. Datenbank-Backups bleiben 14 Tage.
       Der Tagesexport geht nach SharePoint.
       Bestätigungen gehen gesammelt einmal täglich ohne Link.
       Das Aufgebot wird gedruckt und per Post versendet.
       Die Rollen laufen über Entra.
       Die Ränge stellt der Admin in der App ein.
       Offerte und SharePoint-Einsatzordner bleiben ausserhalb des Tools.
10. Hinweis zur Quelle
Das Transkript trennt die Sprecher nicht. Schweizerdeutsch und gleichzeitiges Sprechen
führen zu Fehlern. Prüfe wichtige Punkte mit der Aufnahme. Ungeprüft ist besonders der
Abschnitt zur Offerte (Minute 64 bis 67) und der Abschnitt über Fremdverpflegung
(Minute 98 bis 106).

Teil B: Umsetzungsspezifikation

11. Grundlagen
Teil B ist der Bauplan. Claude kann das Tool nach Teil B in einem Durchgang
programmieren. Teil A nennt die Anforderungen. Teil B legt Technik, Daten und Regeln
fest.

Wo Teil A eine Frage offen lässt, trifft Teil B eine Annahme. Jede Annahme ist markiert.
Jede Annahme ist änderbar, ohne den Rest zu stören.

11.1 Technik (Annahme)

  Bereich                      Wahl

  Laufzeit                     Node.js 22 LTS, TypeScript

  Web-Server                   Express 5

  Datenbank                    SQLite über better-sqlite3 , WAL-Modus,
                               Fremdschlüssel an

  Oberfläche                   Serverseitig erzeugtes HTML, kleines CSS, wenig
                               JavaScript. Kein Frontend-Framework.

  E-Mail                        nodemailer über SMTP

  CSV lesen                     csv-parse

  iCal lesen                    node-ical

  ICS schreiben                von Hand (Textformat), ohne Bibliothek

  Login                         Microsoft Entra ID (OpenID Connect) über
                               openid-client

  Tests                         node:test , ohne Bibliothek

  Zeitzone                      Europe/Zurich . Die Datenbank speichert Zeiten
                               als UTC (ISO 8601). Die Oberfläche zeigt lokale Zeit.
  Bereich                      Wahl

  Sprache                      Oberfläche, Mails und Datenbanknamen sind
                               Deutsch. Code-Kommentare sind Deutsch.

Grund: Wenige Abhängigkeiten verringern das Sicherheitsrisiko (siehe Abschnitt 6).

11.2 Projektstruktur

   einsatzplaner/
     package.json
       tsconfig.json
       CLAUDE.md                                     Designentscheide (siehe 22.4)
       README.md                                     Start, Konfiguration, Betrieb
       .env.example
       src/
         server.ts                                   Start, Routen verbinden
         config.ts                                   liest Umgebungsvariablen
           db/
             schema.sql                              Schema aus Abschnitt 12
             migrate.ts                              legt Schema an, führt Migrationen aus
             seed.ts                                 Rollen, Ränge, erster Admin
           domain/                                   reine Logik ohne Web (testbar)
               einsatz.ts schicht.ts anmeldung.ts warnungen.ts
               import-clubdesk.ts ics.ts ical-abgleich.ts export.ts
           web/
             routes-*.ts                             eine Datei je Bereich
             views/*.ts                              HTML-Vorlagen als Funktionen
             public/style.css
           jobs/
               mail-worker.ts                        sendet Einträge aus mail_queue
               tagesexport.ts                        täglicher Export
               ical-cache.ts                         holt den Clubdesk-iCal-Feed
               bestaetigungsmail.ts                  sendet täglich die gesammelten Bestätigungen
       test/                                         ein Test je Regel aus Abschnitt 23

11.3 Konfiguration
Alle Werte kommen aus Umgebungsvariablen. .env.example nennt alle.

  Variable                                                       Bedeutung

   PORT , BASE_URL                                               Port und öffentliche Adresse des Tools

   DB_PATH                                                       Pfad zur SQLite-Datei
  Variable                                           Bedeutung

   SESSION_SECRET                                    Schlüssel für Cookies

   SMTP_HOST , SMTP_PORT , SMTP_USER ,               Mail-Server (Exchange)
   SMTP_PASS

   MAIL_FROM                                         Aufgebotsadresse als Absender

   MAIL_ROMAN                                        Adresse für Änderungswünsche an
                                                     Clubdesk

   CLUBDESK_ICAL_URL                                 Adresse des iCal-Feeds von Clubdesk

   EXPORT_DIR                                        Ordner für den Tagesexport

   SHAREPOINT_SITE_ID,                               Ziel des Tagesexports auf SharePoint
  SHAREPOINT_DRIVE_ID, SHAREPOINT_ORDNER

   EXPORT_HOUR                                       Stunde des Tagesexports, Standard 2

   FORM_ALLOWED_ORIGIN                               Seite, die das Formular einbetten darf
                                                     (Clubdesk)

11.4 Allgemeine Regeln für den Code
   1. Jede Schreibaktion läuft in einer Transaktion.
   2. Jede Änderung an einer Anmeldung schreibt einen Eintrag in status_log in
       derselben Transaktion.
   3. Regeln stehen in src/domain/ . Routen rufen nur diese Funktionen auf.
   4. Warnungen sind Daten (Code + Text). Sie blockieren keine Aktion. Die Oberfläche
       zeigt sie an und lässt den Benutzer weitermachen.
   5. Jede Eingabe wird auf dem Server geprüft. Jede Ausgabe in HTML wird maskiert.
   6. Das Tool löscht nie Daten ohne Bestätigung des Benutzers.

12. Datenbankschema
 src/db/schema.sql enthält genau dieses Schema. Zeiten sind Text in UTC (ISO 8601).

   PRAGMA foreign_keys = ON;
   PRAGMA journal_mode = WAL;

   -- Benutzer des Tools (Aufgebotsstelle, Admin)
   CREATE TABLE benutzer (
     id            INTEGER PRIMARY KEY,
        name                       TEXT NOT NULL,
        email                      TEXT NOT NULL UNIQUE,
        entra_oid                  TEXT NOT NULL UNIQUE,
        rolle                      TEXT NOT NULL CHECK (rolle IN ('admin','aufgebot')),
        aktiv                      INTEGER NOT NULL DEFAULT 1
   );

   CREATE TABLE sitzung (
        id                     TEXT PRIMARY KEY,
        benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
        ablauf      TEXT NOT NULL
   );

   -- Rangfolge, vom Admin gepflegt. Kleinere Zahl = niedrigerer Rang.
   CREATE TABLE rang (
        id                     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        reihenfolge INTEGER NOT NULL UNIQUE
   );

   -- Rollen in einer Schicht. 'Sektorchef' zählt nicht als Teilnehmer.
   CREATE TABLE rolle (
        name                               TEXT PRIMARY KEY,
        reihenfolge       INTEGER NOT NULL,
        zaehlt_teilnehmer INTEGER NOT NULL DEFAULT 1
   );

   -- Personen. Nur der Import schreibt hier. Der Schlüssel ist die Clubdesk-ID.
   CREATE TABLE person (
        clubdesk_id                              INTEGER PRIMARY KEY,
        vorname                                  TEXT,
        nachname                                 TEXT,
        geburtsdatum                             TEXT,                      -- YYYY-MM-DD
        rang_id                                  INTEGER REFERENCES rang(id),
        strasse                                  TEXT,
        adresszusatz                             TEXT,
        plz                                      TEXT,
        ort                                      TEXT,
        telefon                                  TEXT,                      -- Telefon Mobil
        telefon_privat                           TEXT,
        email                                    TEXT,
        essenseinschraenkung TEXT,
        importiert_am        TEXT NOT NULL,
        geloescht_am                             TEXT                       -- gesetzt = Personendaten
   gelöscht, ID bleibt
   );
   CREATE INDEX idx_person_name ON person(nachname, vorname);

   CREATE TABLE einsatz (
     id               INTEGER PRIMARY KEY,
        name                             TEXT NOT NULL,
        ort              TEXT,
        bemerkung_intern TEXT,
        bemerkung_extern TEXT,
        erstellt_am                      TEXT NOT NULL,
        erstellt_von                     INTEGER REFERENCES benutzer(id),
        abtreten_ort                     TEXT,
        tenue                            TEXT,
        aufgebot_hinweis TEXT
   );

   CREATE TABLE schicht (
        id                               INTEGER PRIMARY KEY,
        einsatz_id                       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
        name                             TEXT NOT NULL,
        start_zeit                       TEXT NOT NULL,
        end_zeit                         TEXT NOT NULL CHECK (end_zeit > start_zeit),
        ort                              TEXT,                          -- Kopie des Einsatz-Orts,
   überschreibbar
        min_alter                        INTEGER,
        min_rang_id                      INTEGER REFERENCES rang(id),
        soll_anzahl                      INTEGER,                       -- Zielwert TN, keine
   Obergrenze
     abtreten_ort                        TEXT,                          -- leer = gleich wie ort
        tenue                            TEXT,
        aufgebot_hinweis TEXT,
        bemerkung_intern TEXT,
        bemerkung_extern TEXT,
        publiziert                       INTEGER NOT NULL DEFAULT 0,
        position                         INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX idx_schicht_einsatz ON schicht(einsatz_id);
   CREATE INDEX idx_schicht_zeit ON schicht(start_zeit, end_zeit);

   -- Benötigte Rollen je Schicht
   CREATE TABLE schicht_rolle (
        schicht_id INTEGER NOT NULL REFERENCES schicht(id) ON DELETE CASCADE,
        rolle      TEXT NOT NULL REFERENCES rolle(name),
        anzahl               INTEGER NOT NULL CHECK (anzahl > 0),
        PRIMARY KEY (schicht_id, rolle)
   );
   -- Eine Person hat pro Schicht höchstens einen Eintrag.
   -- Kein Eintrag = Person wurde nicht gefragt.
   -- person_id ist NULL, wenn die Person unbekannt ist oder aus der Datenbank
   entfernt wurde.
   CREATE TABLE anmeldung (
     id            INTEGER PRIMARY KEY,
        schicht_id                 INTEGER NOT NULL REFERENCES schicht(id) ON DELETE CASCADE,
        person_id                  INTEGER REFERENCES person(clubdesk_id) ON DELETE SET NULL,
     name_text     TEXT NOT NULL,                                    -- Name zum Zeitpunkt der
   Anmeldung (Archiv)
        email_text                 TEXT,                             -- nur bei unbekannten
   Personen
     status                        TEXT NOT NULL CHECK (status IN

   ('angemeldet','bestaetigt','abgemeldet','unsicher','nachricht_gesendet')),
        rolle                      TEXT REFERENCES rolle(name),
        kanal                      TEXT NOT NULL CHECK (kanal IN
   ('formular','telefon','whatsapp','muendlich')),
        bemerkung                  TEXT,
        erstellt_am                TEXT NOT NULL,
        geaendert_am               TEXT NOT NULL,
        mail_gesendet_am TEXT,                                       -- leer = Bestätigungsmail
   noch offen
     UNIQUE (schicht_id, person_id)
   );
   CREATE INDEX idx_anmeldung_person ON anmeldung(person_id);

   CREATE TABLE status_log (
        id                       INTEGER PRIMARY KEY,
        anmeldung_id INTEGER NOT NULL REFERENCES anmeldung(id) ON DELETE CASCADE,
        zeit         TEXT NOT NULL,
        benutzer_id              INTEGER REFERENCES benutzer(id),    -- NULL = Formular oder
   System
     aktion                      TEXT NOT NULL,                      -- z. B. 'erstellt',
   'status', 'rolle', 'kanal', 'bemerkung'
        alt_wert                 TEXT,
        neu_wert                 TEXT
   );
   CREATE INDEX idx_log_anmeldung ON status_log(anmeldung_id, zeit);

   -- Fremdabteilungen einer Schicht. Sie zählen als TN und beim Essen.
   CREATE TABLE fremdabteilung (
        id                   INTEGER PRIMARY KEY,
        schicht_id INTEGER NOT NULL REFERENCES schicht(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        anzahl               INTEGER NOT NULL CHECK (anzahl > 0),
        bemerkung            TEXT
   );
   CREATE INDEX idx_fremdabteilung_schicht ON fremdabteilung(schicht_id);

   -- Merkt, ob ein ICS-Export für eine Schicht schon stattfand (Duplikat-
   Warnung)
   CREATE TABLE ics_export (
        schicht_id    INTEGER PRIMARY KEY REFERENCES schicht(id) ON DELETE CASCADE,
        exportiert_am TEXT NOT NULL,
        benutzer_id                INTEGER REFERENCES benutzer(id)
   );

   CREATE TABLE mail_queue (
        id                     INTEGER PRIMARY KEY,
        an                     TEXT NOT NULL,
        reply_to               TEXT,
        betreff                TEXT NOT NULL,
        text        TEXT NOT NULL,
        erstellt_am TEXT NOT NULL,
        gesendet_am TEXT,
        fehler                 TEXT, versuche INTEGER NOT NULL DEFAULT 0
   );

   CREATE TABLE import_log (
        id                     INTEGER PRIMARY KEY,
        zeit                   TEXT NOT NULL,
        benutzer_id INTEGER REFERENCES benutzer(id),
        dateiname              TEXT,
        neu                    INTEGER NOT NULL,
        geaendert              INTEGER NOT NULL,
        entfernt               INTEGER NOT NULL
   );

Seed-Daten ( seed.ts , nur wenn die Tabellen leer sind):

        Rollen: Einsatzleitung (zählt), Busfahrer (zählt), Sektorchef (zählt nicht als
        Teilnehmer).
        Ränge: Es gibt keine Startwerte. Der Admin legt sie in den Einstellungen an (Abschnitt
        14.5).
        Der erste Admin entsteht beim ersten Login mit der Entra-Rolle Admin (siehe 22.1).

Annahmen zum Schema:

        Die Person hat ein Geburtsdatum. Falls der Clubdesk-Export nur ein Alter enthält,
        speichert das Tool ein Feld alter statt geburtsdatum .
       Die Anmeldung speichert den Namen als Text. So bleibt das Archiv lesbar, wenn die
       Person entfernt wird.
       Der Ort einer Schicht ist eine Kopie. Das Tool aktualisiert sie nach Regel 13.3.

13. Geschäftsregeln und Warnungen

13.1 Einsatz erstellen
   1. Eingaben: Name, Start (Datum und Uhrzeit), Ende, optional Ort.
   2. Das Tool legt automatisch eine Standardschicht an. Sie hat den Namen des Einsatzes,
      die Zeiten und den Ort der Eingabe. Sie hat publiziert = 1 .
   3. Das Tool zeigt danach die Einsatz-Übersicht.

13.2 Schichten
   1. Die Aufgebotsstelle kann Schichten hinzufügen, ändern und löschen.
   2. Eine neue zusätzliche Schicht hat publiziert = 0 (Annahme). Der Ort der neuen
       Schicht ist der Ort des Einsatzes.
   3. Das Tool sortiert Schichten nach Startzeit.
   4. Das Löschen einer Schicht mit Anmeldungen verlangt eine Bestätigung. Das Tool
       zeigt die Zahl der Anmeldungen.
   5. Das Tool zeigt Datum und Zeit einer Schicht immer in lokaler Zeit. Das Datum ergibt
       sich aus der Startzeit. Eine Schicht darf über Mitternacht gehen.

13.3 Vererbung des Orts
   1. Ändert die Aufgebotsstelle den Ort des Einsatzes von A auf B, ersetzt das Tool den
       Ort in allen Schichten dieses Einsatzes, deren Ort genau A ist.
   2. Schichten mit anderem Ort bleiben unverändert.
   3. In der Schicht zeigt das Feld Ort den aktuellen Wert. Eine Änderung dort überschreibt
       den Wert nur für diese Schicht.
   4. Vererbt werden nur Ort, Ort Abtreten, Tenue und Hinweis Aufgebot (siehe Abschnitt
       20). Alle anderen Felder gehören zur Schicht.

13.4 Sichtbarkeit im Formular
Eine Schicht ist im Anmeldeformular sichtbar, wenn beide Bedingungen gelten:

        schicht.publiziert = 1

        schicht.end_zeit liegt in der Zukunft
Beispiel slowUp: Die Schicht „Anmeldung“ ist publiziert. Die Sektor-Schichten sind es
nicht. Die Aufgebotsstelle teilt Personen später in die Sektor-Schichten ein.

13.5 Anmeldung: Status und Rolle

  Status (Wert in DB)                       Gesetzt durch     Wirkung

   angemeldet                               Formular oder     zählt als unbestätigt
                                            Aufgebotsstelle

   bestaetigt                               Aufgebotsstelle   Zählt zur Besetzung. Die
                                                              Bestätigungsmail geht im
                                                              Tagesversand (18.2) .

   abgemeldet                               Aufgebotsstelle   zählt nicht

   unsicher                                 Aufgebotsstelle   Bemerkung nennt den Grund oder die
                                                              Frist. Zählt nicht zur Besetzung.

   nachricht_gesendet                       Aufgebotsstelle   Die Aufgebotsstelle wartet auf
                                                              Antwort. Zählt nicht zur Besetzung.

  (kein Eintrag)                            —                 Person wurde nicht gefragt oder nicht
                                                              erreicht

   1. Jeder Wechsel zwischen allen Status ist erlaubt. Das Tool sperrt keinen Wechsel.
   2. Die Rolle wird bei jedem Status gespeichert. Sie zählt nur bei bestaetigt .
   3. Das Tool schreibt bei jeder Änderung von Status, Rolle, Kanal oder Bemerkung einen
       Eintrag in status_log .
   4. Eine Person hat pro Schicht einen Eintrag ( UNIQUE ). Ein zweiter Versuch ändert den
       bestehenden Eintrag.
   5. Meldet sich eine Person über das Formular an und hat schon einen Eintrag,
       überschreibt das Formular den Status nicht. Das Tool hängt die Bemerkung an und
       schreibt einen Log-Eintrag.

13.6 Zählung
Pro Schicht zeigt das Tool diese Zahlen:

       Teilnehmende: Einträge mit bestaetigt , deren Rolle leer ist oder
        zaehlt_teilnehmer = 1 hat. Dazu kommt die Summe von fremdabteilung.anzahl.
       Fremdabteilungen zählen als TN.
       Je Rolle: Einträge mit bestaetigt und dieser Rolle, im Vergleich zu
        schicht_rolle.anzahl .
       Unbestätigt: Einträge mit angemeldet .
       Unsicher und Nachricht gesendet: je eine Zahl.
       Essen: Teilnehmende (mit Fremdabteilungen) plus Rollen ohne Teilnehmerzählung.
       Der Sektorchef isst also mit, zählt aber nicht als Teilnehmer.

13.7 Warnungen
Eine Warnung hat einen Code und einen Text. Das Tool zeigt sie neben dem Eintrag. Sie
sperrt nichts.

  Code                              Bedingung                             Text (Beispiel)

   W_UEBERLAPP                      Die Person hat in einer anderen       „Nimmt gleichzeitig an Schicht X
                                    Schicht einen Eintrag mit             teil.“
                                    angemeldet oder bestaetigt .
                                    Die Zeiten überlappen: a.start <
                                    b.ende UND b.start < a.ende .

   W_ALTER                          Alter der Person am Starttag der      „Jünger als das Mindestalter (16).“
                                    Schicht ist kleiner als min_alter .

   W_RANG                           Rang der Person ist niedriger als     „Rang unter dem Mindestrang.“
                                    min_rang , oder die Person hat
                                    keinen Rang.

   W_ROLLE_FEHLT                    Bestätigte Personen mit Rolle sind    „Es fehlen 2 Busfahrer.“
                                    weniger als anzahl .

   W_UNBEKANNT                       person_id ist leer bei einer         „Person nicht in Clubdesk-Daten.“
                                    Anmeldung aus dem Formular.

   W_ICS_DUPLIKAT                   Für die Schicht gibt es schon         „Export fand am … statt.
                                    einen ICS-Export.                     Clubdesk erhält sonst einen
                                                                          doppelten Termin.“

   W_TERMIN_FEHLT                   Der Abgleich findet keinen Termin     „Kein Clubdesk-Termin gefunden.“
                                    im iCal-Feed.

   W_TERMIN_ZEIT                    Der Termin im Feed hat andere         „Zeiten in Clubdesk weichen ab.“
                                    Zeiten.

   W_AUSTRITT                       Beim Import fehlt eine Person mit     „Person fehlt in der CSV. Zuerst
                                    künftigen Anmeldungen.                abmelden.“

Die Funktion warnungenFuerAnmeldung(anmeldungId) und
 warnungenFuerSchicht(schichtId) in warnungen.ts liefert die Liste.
13.8 Alter
Das Alter ist die Zahl voller Jahre zwischen geburtsdatum und dem lokalen Datum der
Startzeit der Schicht.

13.9 Archiv
Ein Einsatz ist vergangen, wenn die letzte end_zeit seiner Schichten in der
Vergangenheit liegt. Vergangene Einsätze erscheinen in der Liste „Archiv“. Das Tool
löscht sie nie automatisch.

14. Routen und Bildschirme
Rollen: öffentlich (ohne Login), aufgebot (Aufgebotsstelle und Admin), admin (nur
Admin). Jede Schreib-Route prüft ein CSRF-Token.

14.1 Routen

  Methode, Pfad                                      Rolle        Funktion

  GET /anmeldung                                     öffentlich   Anmeldeformular (Abschnitt 15)

  POST /anmeldung                                    öffentlich   Formular absenden

  GET /anmeldung/danke                               öffentlich   Bestätigungsseite

  GET /login , GET /login/callback ,                 öffentlich   Anmeldung mit Microsoft Entra
  POST /logout                                                    ID

  GET /                                              aufgebot     Start: kommende Einsätze mit
                                                                  Zahlen und Warnungen

  GET /einsaetze?                                    aufgebot     Liste der Einsätze
  ansicht=kommend|archiv

  GET /einsaetze/neu , POST /einsaetze               aufgebot     Einsatz erstellen (13.1)

  GET /einsaetze/:id                                 aufgebot     Einsatz-Übersicht

  GET /einsaetze/:id/bearbeiten , POST               aufgebot     Einsatz ändern
   /einsaetze/:id

  POST /einsaetze/:id/kopieren                       aufgebot     Einsatz kopieren (21.1)

  POST /einsaetze/:id/loeschen                       aufgebot     Einsatz löschen (mit Bestätigung)

  GET /einsaetze/:id/export.csv                      aufgebot     Teilnehmerliste als CSV
  Methode, Pfad                                      Rolle      Funktion

  GET /einsaetze/:id/schichten/neu ,                 aufgebot   Schicht hinzufügen
  POST /einsaetze/:id/schichten

  GET /schichten/:sid                                aufgebot   Schicht-Detail

  GET /schichten/:sid/bearbeiten , POST              aufgebot   Schicht ändern, inkl. Rollenbedarf
   /schichten/:sid

  POST /schichten/:sid/publizieren                   aufgebot   Schalter publiziert

  POST /schichten/:sid/loeschen                      aufgebot   Schicht löschen

  POST                                               aufgebot   Fremdabteilung anlegen, ändern
   /schichten/:sid/fremdabteilungen                             oder löschen (Name, Anzahl,
                                                                Bemerkung)

  GET /schichten/:sid/essensliste.csv                aufgebot   Essenseinschränkungen als CSV

  GET /schichten/:sid/anrufliste                     aufgebot   Anrufliste (14.3)

  POST /schichten/:sid/anmeldungen                   aufgebot   Person von Hand anmelden
                                                                (Kanal wählen)

  POST /schichten/:sid/sammelstatus                  aufgebot   Status für mehrere Personen
                                                                setzen

  POST /anmeldungen/:id                              aufgebot   Status, Rolle, Kanal, Bemerkung
                                                                ändern

  POST /anmeldungen/:id/loeschen                     aufgebot   Eintrag entfernen

  GET /schichten/:sid/ics                            aufgebot   ICS-Datei laden (Abschnitt 17)

  GET /schichten/:sid/termintext                     aufgebot   Text für den Clubdesk-Termin

  GET /schichten/:sid/aufgebot                       aufgebot   Druckansicht des Aufgebots
                                                                (Abschnitt 20)

  GET /personen , GET /personen/:id                  aufgebot   Personen lesen, suchen,
                                                                Anmeldungen sehen

  GET /admin/import , POST                           admin      Clubdesk-Import (Abschnitt 16)
  /admin/import , POST
   /admin/import/anwenden

  GET/POST /admin/benutzer ,                         admin      Stammdaten pflegen
  /admin/raenge , /admin/rollen

  GET /admin/export , POST                           admin      Tagesexport anzeigen und
   /admin/export/jetzt                                          auslösen
14.2 Einsatz-Übersicht (Hauptbildschirm)
       Kopf: Name, Zeitraum, Ort, Buttons Bearbeiten und Kopieren.
       Je Schicht eine Karte mit Name, Zeit, Ort, Schalter „Publiziert“ und den Zahlen aus
       13.6.
       Die Karte zeigt Warnungen (13.7) als Liste.
       Die Karte zeigt den Abgleich mit Clubdesk (17.4): grün, rot oder grau.
       Darunter steht die Matrix: Zeilen sind Personen, Spalten sind Schichten. Jede Zelle
       zeigt den Status als farbiges Kennzeichen. Eine Person in zwei Schichten ist so sofort
       sichtbar.
       Ein Klick auf die Zelle öffnet ein kleines Formular für Status, Rolle, Kanal und
       Bemerkung.

14.3 Schicht-Detail und Anrufliste
       Das Detail zeigt alle Einträge der Schicht als Tabelle: Name, Rang, Alter, Status, Rolle,
       Kanal, Bemerkung, Warnungen, Essenseinschränkung. Es gibt Filter nach Status.
       Es gibt ein Feld zum Anmelden einer Person von Hand: Suche nach Name, Kanal,
       Status.
       Die Anrufliste zeigt Personen ohne Eintrag in dieser Schicht sowie Personen mit
        unsicher oder nachricht_gesendet .
       Die Liste zeigt Telefonnummer, Rang und Alter. Sie blendet Personen aus, die das
       Mindestalter oder den Mindestrang nicht erfüllen (Schalter zum Einblenden).
       Pro Zeile gibt es Knöpfe: „Angemeldet“, „Bestätigt“, „Unsicher“, „Abgemeldet“. Ein
       Klick legt den Eintrag an und schreibt den Kanal telefon .
       Mit Haken in der Liste setzt der Knopf „Nachricht gesendet“ den Status für alle
       gewählten Personen. Der Kanal ist dann whatsapp .

14.4 Personen-Ansicht
       Lesend. Das Tool zeigt Personendaten und die Anmeldungen der Person (kommend
       und vergangen).
       Der Knopf „Änderung melden“ öffnet einen mailto: -Link an MAIL_ROMAN . Betreff:
       „Änderung Personendaten“. Text: Clubdesk-ID, Name und eine Zeile „Bitte ändern: …“
       (Annahme).
14.5 Einstellungen: Ränge
Die Seite „Einstellungen“ (Route /admin/raenge , nur Admin) pflegt die Ränge. Es gibt
keine fest eingebauten Ränge.

   1. Der Admin legt einen Rang mit Namen an.
   2. Der Admin ändert die Reihenfolge mit den Knöpfen „Höher“ und „Tiefer“. Die
       Reihenfolge ist die Rangfolge. Der oberste Rang ist der höchste.
   3. Der Admin benennt einen Rang um. Die Zuordnung zu Personen und Schichten bleibt
       erhalten.
   4. Der Admin löscht einen Rang nur, wenn keine Person und keine Schicht ihn nutzt.
       Sonst nennt das Tool die Zahl der Nutzer.
   5. Der Import (Abschnitt 16) ordnet den Rang einer Person über den Namen zu. Ein
       unbekannter Name erscheint in der Vorschau. Der Admin legt den Rang an und
       importiert neu.
   6. Die Rangfolge steuert den Mindestrang einer Schicht (13.7, W_RANG ) und die Auswahl
       in der Schicht-Maske.

14.6 Unbekannte Anmeldungen zuordnen
Nur der Import legt Personen an oder ändert sie. Eine Anmeldung aus dem Formular ohne
eindeutigen Treffer bleibt unzugeordnet ( person_id leer).

   1. Die Startseite zeigt den Kasten „Unbekannte Anmeldungen (n)“. Die Einsatz-
       Übersicht zeigt W_UNBEKANNT .
   2. Route GET /anmeldungen/unbekannt listet alle unzugeordneten Einträge: Name und
       E-Mail aus dem Formular, Einsatz, Schicht, Datum, Bemerkung.
   3. Je Eintrag gibt es ein Suchfeld nach Name in den Personen (ohne gelöschte). Das Tool
       zeigt Personen mit gleichem Nachnamen oder gleichem Vornamen zuerst. Bei einem
       Hinweis „Mehrdeutig“ zeigt es die genannten Clubdesk-IDs vorab.
   4. Route POST /anmeldungen/:id/zuordnen mit person_id setzt die Person. Das Tool
       setzt name_text auf den Namen der Person und leert email_text . Es schreibt einen
       Log-Eintrag mit der Aktion zugeordnet .
   5. Hat die Person in dieser Schicht schon einen Eintrag, zeigt das Tool „Person hat schon
       einen Eintrag.“ Die Aufgebotsstelle wählt „Unbekannten Eintrag löschen“ oder bricht
       ab. Das Tool führt Einträge nie automatisch zusammen.
   6. Findet die Aufgebotsstelle die Person nicht (z. B. ein neues Mitglied, das erst im
       nächsten Import erscheint), lässt sie den Eintrag unzugeordnet. Sie ordnet ihn nach
       dem nächsten Import zu.
   7. Die Aufgebotsstelle kann einen unzugeordneten Eintrag bestätigen. Die Bestätigung
       geht an email_text (18.2). Das Aufgebot zeigt dann den Hinweis „Adresse fehlt“.
15. Anmeldeformular und Einbettung
Es gibt ein einziges Formular für alle Einsätze. Clubdesk bettet es per iframe unter der
Adresse BASE_URL/anmeldung ein.

15.1 Einbettung
   1. Die Route /anmeldung sendet den Header Content-Security-Policy: frame-
       ancestors <FORM_ALLOWED_ORIGIN> .
   2. Alle anderen Routen senden X-Frame-Options: DENY .
   3. Das Formular nutzt keine Cookies. Das Tool schützt es mit einem signierten Token im
       Formular (HMAC mit SESSION_SECRET , Gültigkeit 2 Stunden). Der Grund: Cookies
       von Drittseiten funktionieren im iframe nicht zuverlässig.
   4. Das Formular ist schmal gebaut (Handy tauglich) und hat keinen Seitenkopf.

15.2 Inhalt
       Eingabefelder: Vorname, Nachname, E-Mail (Pflicht, wird als Textbeleg gespeichert),
       Bemerkung (frei).
       Optionales Feld „Essenseinschränkungen“ mit dem Hinweis: „Nur ausfüllen, wenn neu
       oder geändert.“ Das Tool speichert die Eingabe in der Bemerkung mit dem Präfix
       „Essen: “. Das Tool ändert keine Personendaten (Annahme).
       Pro publizierter Schicht (13.4) eine Auswahl-Box, gruppiert nach Einsatz. Je Einsatz
       zeigt das Formular Name und externe Bemerkung. Je Schicht zeigt es Name, Datum,
       Zeit, Ort, externe Bemerkung und das Mindestalter als Hinweis.
       Mindestens eine Schicht muss gewählt sein.
       Verstecktes Feld als Falle für Bots (Honeypot). Ist es gefüllt, verwirft das Tool die
       Anfrage ohne Fehlermeldung.
       Grenze: 20 Anfragen pro Stunde je IP-Adresse.

15.3 Verarbeitung beim Absenden
   1. Das Tool prüft das Token, die Pflichtfelder und die Längen. Es prüft, ob jede gewählte
       Schicht noch sichtbar ist (13.4).
   2. Das Tool sucht die Person: gleicher Vorname und Nachname, ohne
       Gross-/Kleinschreibung, ohne Leerzeichen am Rand, Umlaute gleichgesetzt.
   3. Genau ein Treffer: person_id ist gesetzt.
   4. Kein Treffer: person_id ist leer. Das Tool speichert name_text und email_text .
       Warnung W_UNBEKANNT .
   5. Mehrere Treffer: wie bei keinem Treffer. Das Tool hängt an die Bemerkung
       „Mehrdeutig: Clubdesk-IDs …“ an.
   6. Je gewählter Schicht legt das Tool einen Eintrag an: Status angemeldet , Kanal
        formular . Gibt es schon einen Eintrag, gilt 13.5 Punkt 5.
   7. Das Tool schreibt je Eintrag einen Log-Eintrag mit benutzer_id leer.
   8. Das Tool leitet auf /anmeldung/danke um.

Text der Dankesseite: „Danke für deine Anmeldung. Sie gilt erst, wenn die Aufgebotsstelle
sie bestätigt. Du bekommst dann eine Mail.“

16. Clubdesk-Import
Der Import ist die einzige Quelle für Personendaten. Er ersetzt den Personenbestand
durch die komplette Clubdesk-CSV.

16.1 Datei und Spalten
   1. Der Admin lädt die komplette CSV hoch. Der Beispiel-Export hat das Trennzeichen ; ,
       jedes Feld in Anführungszeichen, Datumsangaben als TT.MM.JJJJ und die Kodierung
       Windows-1252. Das Tool erkennt das Trennzeichen ( ; oder , ) und die Kodierung
       (zuerst strenges UTF-8, sonst Windows-1252).
   2. Das Tool liest nur die Spalten der folgenden Tabelle. Es ignoriert alle anderen Spalten.
       Es speichert sie nicht und zeigt sie nicht an. Das gilt besonders für Bank- und
       Zahlungsdaten (IBAN, BIC, Kontoinhaber, Depotgeld), Notfallkontakt und
       Bemerkungen.
   3. Die Datei src/config/clubdesk-spalten.ts ordnet jedem Feld die Überschrift aus
       der Tabelle zu. Beim Vergleich der Überschriften behält das Tool nur die Buchstaben a
       bis z und die Ziffern und schreibt klein. So passt [Id] zu id . Umlaute stören nicht,
       auch wenn die Kodierung falsch erkannt wird.

  Feld im Tool                                  Spalte im Clubdesk-Export   Pflicht   Regel

   clubdesk_id                                   [Id]                       ja        Ganze Zahl, eindeutig.
                                                                                      Nicht Benutzer-Id .

   vorname                                       Vorname                    ja

   nachname                                      Nachname                   ja
  Feld im Tool                                  Spalte im Clubdesk-Export   Pflicht   Regel

   geburtsdatum                                  Geburtsdatum               nein      Format TT.MM.JJJJ. Die
                                                                                      Spalte Alter bleibt
                                                                                      ungenutzt. Das Tool
                                                                                      rechnet das Alter selbst
                                                                                      (13.8).

   rang                                          Rang                       nein      Text. Das Tool ordnet ihn
                                                                                      einem Rang aus den
                                                                                      Einstellungen zu (14.5).

   strasse                                       Adresse                    nein      Nötig für das Aufgebot.

   adresszusatz                                  Adress-Zusatz              nein

   plz, ort                                      PLZ, Ort                   nein      Nötig für das Aufgebot.

   telefon ,                                     Telefon Mobil, Telefon     nein      Text unverändert. Das
  telefon_privat                                Privat                                Tool speichert beide
                                                                                      Nummern. Die
                                                                                      Hauptnummer ist
                                                                                      Mobil. Jede Anzeige
                                                                                      und jeder Export
                                                                                      nennt Mobil zuerst,
                                                                                      dann Privat, getrennt
                                                                                      durch " / ". Ist
                                                                                      Mobil leer, zeigt das
                                                                                      Tool nur Privat.
                                                                                      Telefon Geschäft
                                                                                      bleibt ungenutzt .

   email                                         E-Mail Verein              nein      Nur Adressen mit der
                                                                                      Endung @web.kkb.ch.
                                                                                      Das Tool nimmt keine
                                                                                      private Adresse. Hat
                                                                                      die Spalte keinen
                                                                                      Wert oder eine andere
                                                                                      Endung, bleibt email
                                                                                      leer. Die Spalten E-
                                                                                      Mail und E-Mail
                                                                                      Alternativ bleiben
                                                                                      ungenutzt. Die
                                                                                      Vorschau zählt
                                                                                      Personen ohne
                                                                                      Vereinsadresse .
  Feld im Tool                                  Spalte im Clubdesk-Export   Pflicht   Regel

   essenseinschraenkung                          Essenseinschränkungen      nein      Freier Text, z. B.
                                                                                      „Vegetarisch“.

Fehlt eine Pflichtspalte, bricht der Import ab. Die Fehlermeldung nennt die gefundenen
Überschriften. Fehlt eine optionale Spalte, bleibt das Feld leer.

16.2 Ablauf der Vorschau
   1. Prüfen. Jede Zeile braucht eine ganzzahlige, eindeutige ID. Zeilen mit Fehlern stehen
       mit Zeilennummer in einer Liste. Gibt es Fehler, bricht der Import ab.
   2. Vergleichen mit der Tabelle person :
              neu: ID fehlt in der Datenbank.
              geändert: ID vorhanden, mindestens ein Feld weicht ab. Die Vorschau zeigt alt
              und neu je Feld.
              unverändert: nur als Zahl.
              entfernt: ID hat in der Datenbank Personendaten, fehlt aber in der CSV. Personen,
              deren Daten schon gelöscht sind, zählen nicht.
   3. Entfernte Personen teilt das Tool in zwei Gruppen:
              Mit künftigen Anmeldungen: Das Tool löscht die Personendaten nicht. Es zeigt
               W_AUSTRITT und nennt die Einsätze. Die Aufgebotsstelle muss die Person zuerst
              aus diesen Einsätzen austragen (Eintrag löschen). Danach ist die Löschung beim
              nächsten Import möglich.
              Ohne künftige Anmeldungen: Die Vorschau zeigt eine Liste. Jede Person hat ein
              Kästchen, vorangekreuzt. Vor dem Anwenden fragt das Tool: „Personendaten von
              n Personen löschen? Die ID bleibt.“ Der Admin muss bestätigen. Personen ohne
              Haken bleiben unverändert.
              Eine künftige Anmeldung ist ein Eintrag mit Status angemeldet , bestaetigt ,
               unsicher oder nachricht_gesendet in einer Schicht, deren end_zeit in der
              Zukunft liegt.
   4. Schutz: Sind mehr als max(5, 10 %) der bestehenden Personen entfernt, zeigt die
       Vorschau ein rotes Banner: „Ungewöhnlich viele Austritte. Prüfe die CSV.“ Der Admin
       muss ein Kästchen ankreuzen, bevor „Anwenden“ funktioniert.
   5. Unbekannter Rang: Kommt ein Rang vor, den es nicht gibt, steht er in einer Liste. Das
       Tool setzt dann rang_id leer. Der Admin kann den Rang in den Einstellungen anlegen
       und neu importieren.
   6. Die Vorschau speichert die geprüfte Datei auf dem Server unter einem Zufallsnamen.
       Der Knopf „Anwenden“ trägt diesen Namen.
16.3 Anwenden
   1. Das Tool läuft in einer einzigen Transaktion.
   2. Es fügt neue Personen ein und aktualisiert geänderte. Es setzt importiert_am .
       Kommt eine Person mit gelöschten Daten wieder in der CSV vor, füllt es die Felder und
       setzt geloescht_am auf leer.
   3. Personendaten löschen (nur für bestätigte Personen): Das Tool setzt vorname ,
        nachname , geburtsdatum , rang_id , strasse , adresszusatz , plz , ort , telefon ,
       telefon_privat, email und essenseinschraenkung auf leer. Es setzt geloescht_am .
       Die Zeile und die clubdesk_id bleiben. In allen Anmeldungen der Person setzt es
        name_text auf „Gelöschte Person <clubdesk_id>“ und leert email_text und
        bemerkung . Das Statusprotokoll bleibt. Das Archiv zählt die Person weiter als
       Teilnehmende.
   4. Gelöschte Personen erscheinen nicht in der Suche, der Anrufliste, dem Aufgebot und
       der Datei personen.csv .
   5. Das Tool verknüpft keine Anmeldungen automatisch. Die Zusammenfassung nennt
       die Zahl der unzugeordneten Anmeldungen (14.6).
   6. Es schreibt eine Zeile in import_log .
   7. Es zeigt eine Zusammenfassung mit Zahlen.

Der Import ist wiederholbar. Eine zweite Anwendung derselben Datei ändert nichts.

17. ICS-Export und iCal-Abgleich

17.1 Termin-Titel und Termintext
Funktion terminTitel(schicht) :

       Hat der Einsatz genau eine Schicht, ist der Titel der Name des Einsatzes.
       Sonst ist der Titel Einsatzname – Schichtname .

Funktion terminText(schicht) erzeugt einen Text mit diesen Zeilen (leere Felder
entfallen):

   Einsatz: <Einsatzname>
   Schicht: <Schichtname>
   Zeit: <Wochentag> <TT.MM.JJJJ>, <HH:MM>–<HH:MM>
   Ort: <Ort>
   Mindestalter: <Zahl>
   Bemerkung: <externe Bemerkung Schicht>
   <externe Bemerkung Einsatz>
Die Seite /schichten/:sid/termintext zeigt den Text mit einem Knopf „Kopieren“.

17.2 ICS-Datei
 src/domain/ics.ts schreibt eine Datei nach RFC 5545:

   BEGIN:VCALENDAR
   VERSION:2.0
   PRODID:-//Verkehrskadetten//Einsatzplaner//DE
   CALSCALE:GREGORIAN
   METHOD:PUBLISH
   BEGIN:VEVENT
   UID:schicht-<id>-<zufall>@einsatzplaner
   DTSTAMP:<jetzt UTC, Format 20261118T080000Z>
   DTSTART:<Start UTC, Format 20261118T070000Z>
   DTEND:<Ende UTC>
   SUMMARY:<terminTitel>
   LOCATION:<Ort>
   DESCRIPTION:<terminText>
   END:VEVENT
   END:VCALENDAR

   1. Zeilenende ist CRLF .
   2. Das Tool faltet Zeilen, die länger als 75 Byte sind (Fortsetzung mit einem Leerzeichen).
   3. Das Tool maskiert \ , ; , , und Zeilenumbrüche im Text.
   4. Zeiten stehen in UTC mit Z . Das vermeidet eine Zeitzonen-Definition.
   5. Der Dateiname ist <terminTitel>.ics ohne Sonderzeichen.
   6. Die Datei enthält genau einen Termin je Schicht. Das Tool bietet keinen Sammel-
       Export.

17.3 Export und Duplikat-Warnung
   1. Der erste Export einer Schicht schreibt eine Zeile in ics_export und liefert die Datei.
   2. Gibt es schon eine Zeile, zeigt das Tool zuerst W_ICS_DUPLIKAT mit Datum und
       Benutzer. Der Knopf „Trotzdem laden“ liefert die Datei und aktualisiert die Zeile.
   3. Das Tool aktualisiert nie einen bestehenden Termin. Wer einen Termin ändern will,
       ändert ihn in Clubdesk von Hand. Das Tool zeigt dann den Abgleich (17.4).

17.4 Abgleich mit dem Clubdesk-iCal-Feed
   1. Der Job ical-cache.ts holt CLUBDESK_ICAL_URL beim Start und danach alle 15
       Minuten. Er liest den Feed mit node-ical und speichert Titel, Start und Ende im
       Speicher.
   2. Schlägt das Holen fehl, bleibt der alte Stand. Das Tool zeigt „Abgleich nicht verfügbar
       seit …“.
   3. Das Tool prüft nur Schichten, deren end_zeit in der Zukunft liegt.
   4. Die Zuordnung: Der Titel im Feed ist nach Normalisierung gleich terminTitel .
       Normalisierung: Leerzeichen am Rand entfernen, mehrfache Leerzeichen zu einem,
       Kleinschreibung. Gibt es mehrere Treffer, gilt der Treffer mit gleichem Starttag.
   5. Ergebnis je Schicht:
               ok : Start und Ende sind gleich.
               zeit_abweicht : Titel gefunden, Zeiten verschieden. Das Tool zeigt die Zeiten aus
              Clubdesk. Warnung W_TERMIN_ZEIT .
               fehlt : kein Treffer. Warnung W_TERMIN_FEHLT .
               unbekannt : Feed nicht geladen.
   6. Die Oberfläche zeigt das Ergebnis als Punkt (grün, rot, grau) in der Schicht-Karte.
   7. Das Tool vergleicht nur Titel und Zeiten, nicht den Text des Termins (Annahme).

18. E-Mails

18.1 Versand
   1. Das Tool schreibt jede Mail zuerst in mail_queue .
   2. Der Job mail-worker.ts prüft die Tabelle alle 10 Sekunden. Er sendet Mails ohne
        gesendet_am über SMTP.
   3. Bei einem Fehler speichert er den Text in fehler und erhöht versuche . Er versucht
       es nach 5 Minuten erneut, höchstens 5 Mal.
   4. Absender ist MAIL_FROM (die Aufgebotsadresse), Anzeigename „Kadetten-Korps
       Basel, Aufgebotsstelle“.
   5. Reply-To ist die Aufgebotsadresse. Es gibt keine „No-Reply“-Adresse.
   6. Die Seite /admin/export zeigt Mails mit Fehler.

Entschieden: Das Tool sendet Bestätigungen gesammelt einmal täglich (Abschnitt 18.2).
Das Tool kennt keine anderen Mails an Personen.

18.2 Bestätigungsmail
   1. Der Job bestaetigungsmail.ts läuft einmal täglich zur Stunde
        BESTAETIGUNG_STUNDE (lokale Zeit, Standard 18). Das ist eine neue
       Umgebungsvariable (ergänzt 11.3). Der Admin kann den Lauf mit dem Knopf
       „Bestätigungen jetzt senden“ auf /admin/export auslösen.
   2. Der Job sucht alle Anmeldungen mit Status bestaetigt und leerem
        mail_gesendet_am , deren Schicht in der Zukunft endet. Er gruppiert sie nach Person.
       Er legt je Person eine Mail in mail_queue an, die alle Schichten nennt. Danach setzt er
        mail_gesendet_am .
   3. Wechselt eine Anmeldung nach bestaetigt , setzt das Tool mail_gesendet_am auf
       leer. Wechselt sie vor dem Tageslauf wieder weg von bestaetigt , entfällt die Mail für
       diese Schicht. Spätere Änderungen nach dem Versand lösen keine neue Mail aus
       (Annahme).
   4. Die Mail enthält keinen Link.
   5. Empfänger ist person.email . Bei einer unzugeordneten Anmeldung ist es
        anmeldung.email_text . Gibt es keine Adresse, sendet das Tool nichts. Es schreibt
       einen Log-Eintrag. Die Seite /admin/export zeigt diese Fälle in einer Liste.
   6. Reply-To ist die Aufgebotsadresse (Annahme: Mehrere Benutzer bestätigen am
       selben Tag).

Vorlage ( src/domain/mail-vorlagen.ts ):

   Betreff: Bestätigung deiner Anmeldung

   Hallo <Vorname>

   Wir bestätigen deine Teilnahme:

   Einsatz: <Einsatzname>
   Schicht: <Schichtname>
   Datum: <Wochentag> <TT.MM.JJJJ>
   Zeit: <HH:MM>–<HH:MM>
   Ort: <Ort>
   Rolle: <Rolle>                                    (Zeile entfällt ohne Rolle)

   (Dieser Block wiederholt sich für jede neu bestätigte Schicht.)

   Bei Fragen antworte auf diese Mail.

   Freundliche Grüsse
   Kadetten-Korps Basel, Aufgebotsstelle

19. Exporte

19.1 Tagesexport (Ausfallschutz)
Ziel: Bei einem Ausfall kann eine nicht technische Person weiterarbeiten.
   1. Der Job tagesexport.ts läuft täglich zur Stunde EXPORT_HOUR (lokale Zeit, Standard
       2). Der Admin kann ihn mit /admin/export/jetzt auslösen.
   2. Er schreibt zwei CSV-Dateien in den Ordner EXPORT_DIR/aktuell/ . Er überschreibt
       dabei die Dateien des Vortags. Format: UTF-8 mit BOM, Trennzeichen ; , Datum
        TT.MM.JJJJ , Zeit HH:MM . So öffnet Excel sie richtig.

               uebersicht.csv : eine Zeile je Anmeldung. Spalten: Einsatz, Schicht, Datum, Start,
              Ende, Ort, Name, Status, Rolle, Kanal, Telefon, E-Mail, Essenseinschränkung,
              Bemerkung. Umfang: alle Schichten mit Ende in der Zukunft oder in den letzten 30
              Tagen.
               personen.csv : Name, Rang, Telefon, E-Mail, Essenseinschränkung. Gelöschte
              Personen fehlen.
   3. Er schreibt eine Kopie der Datenbank: VACUUM INTO
       'EXPORT_DIR/backup/datenbank-<JJJJ-MM-TT>.sqlite' .
   4. Er lädt die zwei CSV-Dateien und die Datenbankkopie nach SharePoint (Microsoft
       Graph, Upload in eine Dokumentenbibliothek). Die CSV-Dateien gehen nach
        SHAREPOINT_ORDNER/aktuell/ und überschreiben dort die alten. Die Datenbankkopie
       geht nach SHAREPOINT_ORDNER/backup/ .
   5. Anmeldung bei Graph: Client-Credentials mit der Entra-App aus 22.1. Die App braucht
       die Anwendungsberechtigung Sites.Selected , freigegeben für die Site. Neue
       Umgebungsvariablen (ersetzen EXPORT_MAIL_TO in 11.3): SHAREPOINT_SITE_ID ,
        SHAREPOINT_DRIVE_ID , SHAREPOINT_ORDNER . Dateien über 4 MB lädt das Tool mit
       einer Upload-Session. Das Tool nutzt fetch und braucht keine neue Bibliothek.
   6. Er löscht Datenbankkopien, die älter als 14 Tage sind, lokal und auf SharePoint.
   7. Er schreibt das Ergebnis ins Log. Bei Fehlern zeigt /admin/export eine rote Meldung.
       Schlägt der Upload fehl, bleiben die lokalen Dateien liegen. Der nächste Lauf versucht
       es erneut.

Datenschutz (entschieden): Die CSV-Dateien liegen nur in der aktuellen Version vor. Das
Tool überschreibt sie täglich. Datenbankkopien bleiben 14 Tage. Nach dem Löschen von
Personendaten (16.3) enthalten Kopien diese Daten noch bis zu 14 Tage. Annahme: Die
Datenbankkopie liegt auch auf SharePoint, weil eine lokale Kopie bei einem Serverausfall
verloren geht.

19.2 Essensliste
Route /schichten/:sid/essensliste.csv . Gleiches CSV-Format wie 19.1.

   1. Erste Zeile: Gesamtzahl Essen nach 13.6.
   2. Danach eine Zeile je Person mit Status bestaetigt und nicht leerer
       Essenseinschränkung: Name, Rolle, Essenseinschränkung.
   3. Je Fremdabteilung eine Zeile am Ende: Name, Anzahl, Bemerkung.

19.3 Teilnehmerliste
Route /einsaetze/:id/export.csv . Eine Zeile je Eintrag mit Status bestaetigt :
Schicht, Name, Rolle, Telefon, Essenseinschränkung.

20. Aufgebot
Das Aufgebot ist ein Brief je bestätigter Person und Schicht. Die Vorlage folgt dem
heutigen Aufgebot des Kadetten-Korps Basel (Beispiel: „43. Basler Stadtlauf – Schicht 1“).
Dieser Abschnitt ergänzt das Datenmodell aus Abschnitt 4 und das Schema aus Abschnitt
12.

   1. Route /schichten/:sid/aufgebot zeigt alle Briefe der Schicht untereinander. Jeder
       Brief hat eine eigene A4-Seite (Druck-CSS mit Seitenumbruch). Mit ?person=
       <clubdesk_id> zeigt die Route nur einen Brief.
   2. Es gibt Briefe nur für Einträge mit Status bestaetigt .
   3. Die Aufgebotsstelle druckt die Briefe und versendet sie per Post. Die Adresse steht
       rechts, wie im Beispiel. Sie passt in ein Fensterkuvert (entschieden).
   4. Die Vorlage liegt fest im Code: src/domain/aufgebot-vorlage.ts . Änderungen am
       festen Text laufen über einen Commit. Eine Bearbeitung in der Oberfläche gibt es in
       Version 1 nicht (Abschnitt 8).
   5. Fehlt die Adresse einer Person, zeigt der Brief am Bildschirm einen roten Hinweis.
       Beim Druck ist der Hinweis unsichtbar.

Aufbau des Briefs. Claude übernimmt den festen Text wörtlich:

   KADETTEN-KORPS BASEL
   Rüchligweg 55
   4125 Riehen

   Ansprechperson                                    <Rang der Person>
   Aufgebotsstelle                                   <Vorname Nachname>
   aufgebot@kkb.ch                                   <Strasse>
                                                     <PLZ Ort>

                                                     Riehen, den <heutiges Datum TT.MM.JJJJ>

   Einsatzaufgebot - <Einsatzname> - <Schichtname>

   Du hast dich für folgenden Einsatz angemeldet. Schon im Voraus herzlichen
   Dank!
   Nachstehend findest du alle nötigen Informationen:

   Antreten                        <Wochentag>, <TT.MM.JJJJ> <HH:MM>, <Ort Antreten>
   Abtreten                        <Wochentag>, <TT.MM.JJJJ> <HH:MM>, <Ort Abtreten>
                                   <Hinweis Aufgebot>                 (Zeile entfällt, wenn
   leer)
   Einsatzleitung                  EL: <Rang> <Vorname Nachname> (<Telefon>)
   Tenue                           <Tenue>                            (Zeile entfällt, wenn
   leer)

   Deine Teilnahme ist definitiv. Falls Du am Einsatz nicht teilnehmen kannst,
   musst du dich
   umgehend per Mail an aufgebot@kkb.ch wenden. Bei krankheitsbedingten Absagen
   weniger als
   drei Tage vor dem Einsatz, melde dich bitte direkt telefonisch bei der
   Einsatzleitung.

   Bei allfäligen Fragen stehe ich dir gerne zur Verfügung.

   Freundliche Grüsse

   KADETTEN-KORPS BASEL
   Aufgebotstelle

Herkunft der variablen Felder:

  Feld im Brief                                      Quelle

  Rang, Name, Strasse, PLZ Ort                       Tabelle person (Import aus Clubdesk)

  Antreten: Datum und Zeit                           schicht.start_zeit (lokale Zeit, Wochentag
                                                     ausgeschrieben)

  Antreten: Ort                                      schicht.ort (darf einen Zusatz enthalten, z. B.
                                                     „(Tram 1,2,14,15)“)

  Abtreten: Datum und Zeit                           schicht.end_zeit

  Abtreten: Ort                                      schicht.abtreten_ort . Ist das Feld leer, gilt
                                                     schicht.ort .

  Hinweis Aufgebot                                   schicht.aufgebot_hinweis (freier Text, gilt für
                                                     alle Briefe der Schicht)

  Einsatzleitung                                     Je bestätigter Person der Schicht mit Rolle
                                                     Einsatzleitung eine Zeile: Rang, Name, Telefon

  Tenue                                              schicht.tenue
  Feld im Brief                                      Quelle

  Briefdatum                                         Datum des Drucks

Die Schicht-Maske hat dafür vier Felder: Ort Antreten (= ort ), Ort Abtreten, Tenue,
Hinweis Aufgebot.

Automatisches Füllen. Jede Angabe in <...> füllt das Tool aus den Daten. Die
Aufgebotsstelle tippt im Brief nichts.

   1. Die Felder Ort Abtreten, Tenue und Hinweis Aufgebot gibt es auch im Einsatz. Sie
       gelten dann für alle Schichten, wie der Ort in 13.3. Das Tool ersetzt den Wert in einer
       Schicht nur, wenn er gleich dem alten Einsatz-Wert ist. Die Schicht kann ihn
       überschreiben.
   2. Hat der Einsatz genau eine Schicht, lautet der Titel Einsatzaufgebot -
       <Einsatzname> . Sonst lautet er Einsatzaufgebot - <Einsatzname> -
       <Schichtname> .
   3. Die Zeile Einsatzleitung nimmt alle bestätigten Personen der Schicht mit Rolle
        Einsatzleitung . Gibt es keine, entfällt die Zeile und das Tool zeigt eine Warnung.
   4. Alle Angaben im festen Text (Zeiten, Orte, Tenue, Hinweis, Einsatzleitung, Mail-
       Adresse) kommen aus Schicht, Einsatz, Person oder Konfiguration. Nichts im Brief ist
       von Hand getippt ausser dem festen Text im Code.
   5. Vor dem Druck zeigt die Seite eine Liste der Lücken: Ort Antreten leer, keine
       Einsatzleitung, Adresse einer Person fehlt, Tenue leer. Die Liste sperrt den Druck
       nicht.

21. Kopieren und Archiv

21.1 Einsatz kopieren
Eingaben: neuer Name (Vorgabe: Name mit Jahr plus 1, sonst gleicher Name) und neues
Startdatum.

   1. Das Tool berechnet die Verschiebung in Tagen: neues Startdatum minus Datum der
       frühesten Startzeit des alten Einsatzes (lokales Datum).
   2. Es kopiert den Einsatz (Name, Ort, Bemerkungen).
   3. Es kopiert alle Schichten mit Name, Ort, Abtreten-Ort, Tenue, Hinweis Aufgebot,
       Mindestalter, Mindestrang, Soll-Anzahl TN, Bemerkungen und Rollenbedarf. Die
       Zeiten verschiebt es um die Tage. Die Uhrzeit bleibt gleich (lokale Zeit, auch über die
       Sommerzeit-Grenze). Alle kopierten Schichten haben publiziert = 0 .
   4. Es kopiert keine Anmeldungen, keine Fremdabteilungen und keinen ICS-Export-
       Vermerk.
   5. Es leitet auf den neuen Einsatz um.

21.2 Archiv
   1. Die Liste „Archiv“ zeigt vergangene Einsätze (13.9), neueste zuerst.
   2. Je Einsatz zeigt sie die Zahl der Teilnehmenden nach 13.6. So lässt sich die Teilnahme
       im Vorjahr vergleichen.
   3. Vergangene Einsätze bleiben lesbar. Personen, die der Import entfernt hat,
       erscheinen mit name_text .

21.3 Einsatz löschen
Das Tool löscht einen Einsatz nur nach Bestätigung. Hat der Einsatz Anmeldungen, nennt
die Bestätigung deren Zahl. Es gibt keine Wiederherstellung. Das nächtliche Backup (19.1)
ist der Schutz.

22. Login, Sicherheit und Betrieb

22.1 Login
   1. Das Tool meldet Benutzer über Microsoft Entra ID an (OpenID Connect,
       Authorization-Code-Flow mit PKCE) mit der Bibliothek openid-client . Das Tool
       speichert keine Passwörter.
   2. Ein Entra-Admin registriert das Tool als App. Er setzt die Redirect-Adresse
        BASE_URL/login/callback . Er legt zwei App-Rollen an: Admin und Aufgebot . Er
       weist sie Benutzern oder Gruppen zu.
   3. Neue Umgebungsvariablen (ergänzen Abschnitt 11.3): ENTRA_TENANT_ID ,
        ENTRA_CLIENT_ID , ENTRA_CLIENT_SECRET .
   4. Die Route /login leitet zu Entra weiter. Die Route /login/callback schliesst den
       Login ab. Das Tool prüft Aussteller, Zielgruppe, Ablaufzeit und nonce des ID-Tokens.
       Es liest oid , name , preferred_username (E-Mail) und roles .
   5. Hat der Benutzer weder die Rolle Admin noch Aufgebot , zeigt das Tool „Kein Zugriff“.
       Hat er beide, gilt Admin .
   6. Beim ersten Login legt das Tool den Benutzer in benutzer an (Schlüssel entra_oid ).
       Bei jedem Login aktualisiert es Name, E-Mail und Rolle. Die Seite /admin/benutzer
       zeigt die Liste und hat den Schalter „aktiv“. Ein inaktiver Benutzer kommt nicht hinein
       (Annahme).
   7. Die Sitzung liegt in der Tabelle sitzung . Das Cookie sid ist HttpOnly , Secure und
        SameSite=Lax . Die Sitzung läuft nach 8 Stunden Inaktivität ab. Die Route /logout
       löscht die Sitzung.
   8. Das öffentliche Formular (Abschnitt 15) braucht keinen Login.

22.2 Sicherheit
   1. Das Tool nutzt nur parametrisierte SQL-Abfragen.
   2. Das Tool maskiert jede Ausgabe in HTML.
   3. Jede POST-Route der Aufgebotsstelle prüft ein CSRF-Token, das an die Sitzung
       gebunden ist.
   4. Alle Seiten senden Content-Security-Policy: default-src 'self' . Inline-Skripte
       sind nicht erlaubt.
   5. HTTPS endet am Reverse-Proxy des Hosters. Das Tool setzt trust proxy .
   6. Die Datei .env und die Datenbank liegen nicht im Git-Repository.
   7. Upload-Dateien (CSV) sind auf 5 MB begrenzt.

22.3 Betrieb
   1. npm run build baut den Code. npm start startet den Server.
   2. Beim Start führt das Tool das Schema aus. PRAGMA user_version steuert
       Migrationen. Wiederholte Starts ändern nichts.
   3. Route GET /health liefert 200 ok ohne Login.
   4. Das Tool schreibt Logs auf die Standardausgabe.
   5. Das Hosting übernimmt Alex. Das README beschreibt Start, Umgebungsvariablen,
       Backup und Wiederherstellung (Datei datenbank.sqlite zurückkopieren).

22.4 Dokumentation
   1. Der Code enthält Kommentare zu jeder Regel aus Abschnitt 13.
   2. README.md beschreibt Betrieb und Konfiguration.
   3. CLAUDE.md hat zwei Teile:
              Grundanforderungen: die Regeln aus den Abschnitten 2 und 5 in kurzer Form.
              Bewusst weggelassen: jede Funktion aus Abschnitt 8 mit der Begründung aus
              dem Gespräch.
   4. Das Ziel: Wer das Tool in fünf Jahren übernimmt, sieht, was Pflicht ist und was jemand
       mit Absicht nicht gebaut hat.
23. Abnahmetests
Jeder Test gehört als Datei in test/ . Alle Tests müssen bestehen.

  Nr.         Szenario                                     Erwartung

  T01         Einsatz mit Name, Start, Ende erstellen      Es gibt genau eine Schicht mit denselben
                                                           Zeiten. Schicht publiziert = 1 .

  T02         Ort des Einsatzes von A auf B ändern.        Schichten mit A haben B. Die Schicht mit
              Eine Schicht hat Ort C.                      C bleibt C.

  T03         Person in zwei überlappenden Schichten       W_UEBERLAPP erscheint. Das Tool
                                                           speichert trotzdem.

  T04         Person in zwei aufeinanderfolgenden          Keine Warnung.
              Schichten (Ende = Start)

  T05         Mindestalter 16. Person wird am Starttag     Keine Warnung. Einen Tag vorher:
              der Schicht 16.                              W_ALTER .

  T06         Formular mit unbekanntem Namen               Eintrag mit person_id leer,
                                                           W_UNBEKANNT , Status angemeldet , Kanal
                                                           formular .

  T07         Formular mit Schicht, die nicht publiziert   Das Tool weist die Schicht ab. Es legt
              ist                                          keinen Eintrag an.

  T08         Status wechselt nach bestaetigt              Keine sofortige Mail. Der Tageslauf
                                                           legt genau eine Mail je Person mit
                                                           allen neu bestätigten Schichten in
                                                           mail_queue an. Ein zweiter Lauf
                                                           ohne neue Bestätigung legt nichts
                                                           an .

  T09         Status, Rolle, Kanal oder Bemerkung          Jede Änderung erzeugt einen
              ändern                                       status_log -Eintrag mit Zeit, Benutzer,
                                                           Alt- und Neuwert.

  T10         Dieselbe Person meldet sich zweimal für      Es bleibt ein Eintrag. Der Status ändert
              dieselbe Schicht an                          sich nicht.

  T11         Sektorchef bestätigt                         Er zählt nicht als Teilnehmer. Er zählt bei
                                                           der Zahl Essen.

  T12         Import mit neuen, geänderten und             Die Vorschau zeigt die richtigen Zahlen.
              fehlenden Personen                           Eine zweite Anwendung derselben Datei
                                                           ändert nichts.
  Nr.         Szenario                                   Erwartung

  T13         Import: fehlende Person mit künftiger      Die erste Person bleibt unverändert
              Anmeldung, und eine ohne                   und W_AUSTRITT erscheint. Bei der
                                                         zweiten leert das Tool nach
                                                         Bestätigung die Personendaten. Die
                                                         Zeile und die ID bleiben .

  T14         Import entfernt mehr als max(5, 10 %)      Anwenden geht erst nach dem
              der Personen                               Ankreuzen des Kontrollkästchens.

  T15         ICS-Export einer Schicht, danach ein       Datei hat CRLF , gefaltete Zeilen, UTC-
              zweiter                                    Zeiten. Der zweite Export zeigt zuerst
                                                         W_ICS_DUPLIKAT .

  T16         iCal-Abgleich mit Feed: gleicher Termin,   Ergebnis ok , zeit_abweicht , fehlt .
              anderer Zeit, ohne Termin

  T17         Tagesexport                                Zwei CSV (UTF-8 BOM, ;) liegen in
                                                         aktuell/ und sind überschrieben.
                                                         Die Datenbankkopie hat das Datum im
                                                         Namen. Kopien über 14 Tage sind
                                                         gelöscht. Der Upload nach
                                                         SharePoint läuft (im Test mit einer
                                                         Attrappe) .

  T18         Einsatz kopieren mit neuem Startdatum      Zeiten um die Differenz verschoben,
                                                         Uhrzeit gleich, publiziert = 0 , keine
                                                         Anmeldungen.

  T19         Aufruf ohne Login, und POST mit            Umleitung zu Microsoft Entra.
              falschem CSRF-Token                        Antwort 403 bei falschem CSRF-
                                                         Token .

  T20         Anrufliste mit Mindestalter.               Personen unter Mindestalter sind
              Sammelstatus für zwei Personen.            ausgeblendet. Beide haben
                                                          nachricht_gesendet , Kanal whatsapp .

Zusätzliche Tests:

  Nr.         Szenario                                   Erwartung

  T21         Unzugeordneten Eintrag einer Person        person_id ist gesetzt, name_text ist
              zuordnen                                   der Name der Person, status_log hat
                                                         die Aktion zugeordnet . Hat die Person
                                                         schon einen Eintrag in der Schicht, führt
                                                         das Tool nichts zusammen.
  Nr.         Szenario                                 Erwartung

  T22         Import einer CSV mit den Spalten IBAN,   Die Datenbank enthält keinen Wert aus
              BIC, Notfallkontakt, Bemerkungen         diesen Spalten. Der Test sucht die Werte
                                                       in allen Textspalten.

  T23         Personendaten einer Person löschen       Alle Personenfelder sind leer,
              (nach Bestätigung)                       geloescht_am ist gesetzt, die ID bleibt.
                                                       Die Anmeldungen zeigen „Gelöschte
                                                       Person <ID>“, email_text und
                                                       bemerkung sind leer. Die Person fehlt in
                                                       Suche, Anrufliste und personen.csv .
                                                       Eine spätere CSV mit derselben ID füllt
                                                       die Felder wieder.

  T24         Import ohne Bestätigung der Rückfrage    Das Tool löscht keine Personendaten.
                                                       Eine Person mit künftiger Anmeldung
                                                       steht nicht in der Liste der löschbaren
                                                       Personen.

  T25         Aufgebot einer Schicht mit Rolle         Der Brief enthält Antreten und Abtreten
              Einsatzleitung                           aus Start und Ende der Schicht. Die Zeile
                                                       Einsatzleitung zeigt Rang, Name und
                                                       Telefon der bestätigten Person mit
                                                       dieser Rolle. Leere Felder (Tenue,
                                                       Hinweis) entfallen.

24. Reihenfolge der Umsetzung
Claude baut in dieser Reihenfolge. Nach jedem Schritt laufen die zugehörigen Tests.

   1. Projekt, Konfiguration, Schema, Seed, Login (Abschnitte 11, 12, 22.1).
   2. Einsätze, Schichten, Regeln, Warnungen, Zählung (13, 14.1 bis 14.3). Tests T01 bis T05,
       T11.
   3. Anmeldungen, Status, Protokoll, Anrufliste (13.5, 14.3). Tests T09, T10, T20.
   4. Import und Personen-Ansicht (16, 14.4). Tests T12 bis T14.
   5. Öffentliches Formular (15). Tests T06, T07.
   6. Mails (18). Test T08.
   7. ICS und Abgleich (17). Tests T15, T16.
   8. Exporte, Aufgebot, Kopieren, Archiv (19 bis 21). Tests T17, T18.
   9. Sicherheit, Dokumentation, CLAUDE.md , README.md (22). Test T19.
Auftrag an Claude
       Lies Teil A und Teil B ganz. Baue genau das, was dort steht.
       Füge keine Funktion hinzu, die das Dokument nicht nennt. Funktionen aus Abschnitt 8
       baust du nicht.
       Wo Teil B eine Annahme nennt, baue die Annahme. Liste alle Annahmen am Ende in
        CLAUDE.md .

       Wo Teil A Offen nennt und Teil B nichts regelt, wähle die einfachste Lösung. Schreibe
       sie in CLAUDE.md .
       Schreibe die Tests aus Abschnitt 23. Das Ergebnis ist fertig, wenn npm test besteht.
```
