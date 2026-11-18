-- Schema des Einsatzplaners (Konzept Abschnitt 12, umgesetzt für MySQL 8 / MariaDB 10.6+).
-- Zeiten sind Text in UTC im ISO-Format (VARCHAR(30)), z. B. 2026-11-18T07:00:00Z.
-- Sortierung utf8mb4_bin. Die Tabelle schema_version steuert die Migrationen.

-- Benutzer des Tools (Aufgebotsstelle, Admin)
CREATE TABLE benutzer (
  id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  entra_oid  VARCHAR(100) NOT NULL UNIQUE,
  rolle      VARCHAR(20) NOT NULL CHECK (rolle IN ('admin','aufgebot')),
  aktiv      TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE sitzung (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  benutzer_id INT NOT NULL,
  ablauf      VARCHAR(30) NOT NULL,
  CONSTRAINT fk_sitzung_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Rangfolge, vom Admin gepflegt. Kleinere Zahl = niedrigerer Rang.
CREATE TABLE rang (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  reihenfolge INT NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Rollen in einer Schicht. 'Sektorchef' zählt nicht als Teilnehmer.
CREATE TABLE rolle (
  name              VARCHAR(100) NOT NULL PRIMARY KEY,
  reihenfolge       INT NOT NULL,
  zaehlt_teilnehmer TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Personen. Nur der Import schreibt hier. Der Schlüssel ist die Clubdesk-ID.
CREATE TABLE person (
  clubdesk_id          INT NOT NULL PRIMARY KEY,
  vorname              VARCHAR(200),
  nachname             VARCHAR(200),
  geburtsdatum         VARCHAR(10),          -- JJJJ-MM-TT
  rang_id              INT,
  strasse              VARCHAR(255),
  adresszusatz         VARCHAR(255),
  plz                  VARCHAR(20),
  ort                  VARCHAR(200),
  telefon              VARCHAR(100),         -- Telefon Mobil
  telefon_privat       VARCHAR(100),
  email                VARCHAR(255),
  essenseinschraenkung TEXT,
  importiert_am        VARCHAR(30) NOT NULL,
  geloescht_am         VARCHAR(30),          -- gesetzt = Personendaten gelöscht, ID bleibt
  CONSTRAINT fk_person_rang FOREIGN KEY (rang_id) REFERENCES rang(id),
  INDEX idx_person_name (nachname, vorname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE einsatz (
  id               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(255) NOT NULL,
  ort              VARCHAR(255),
  bemerkung_intern TEXT,
  bemerkung_extern TEXT,
  erstellt_am      VARCHAR(30) NOT NULL,
  erstellt_von     INT,
  abtreten_ort     VARCHAR(255),
  tenue            VARCHAR(255),
  aufgebot_hinweis TEXT,
  CONSTRAINT fk_einsatz_benutzer FOREIGN KEY (erstellt_von) REFERENCES benutzer(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE schicht (
  id               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  einsatz_id       INT NOT NULL,
  name             VARCHAR(255) NOT NULL,
  start_zeit       VARCHAR(30) NOT NULL,
  end_zeit         VARCHAR(30) NOT NULL,
  ort              VARCHAR(255),             -- Kopie des Einsatz-Orts, überschreibbar
  min_alter        INT,
  min_rang_id      INT,
  soll_anzahl      INT,                      -- Zielwert TN, keine Obergrenze
  abtreten_ort     VARCHAR(255),             -- leer = gleich wie ort
  tenue            VARCHAR(255),
  aufgebot_hinweis TEXT,
  bemerkung_intern TEXT,
  bemerkung_extern TEXT,
  publiziert       TINYINT NOT NULL DEFAULT 0,
  position         INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_schicht_zeit CHECK (end_zeit > start_zeit),
  CONSTRAINT fk_schicht_einsatz FOREIGN KEY (einsatz_id) REFERENCES einsatz(id) ON DELETE CASCADE,
  CONSTRAINT fk_schicht_rang FOREIGN KEY (min_rang_id) REFERENCES rang(id),
  INDEX idx_schicht_einsatz (einsatz_id),
  INDEX idx_schicht_zeit (start_zeit, end_zeit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Benötigte Rollen je Schicht
CREATE TABLE schicht_rolle (
  schicht_id INT NOT NULL,
  rolle      VARCHAR(100) NOT NULL,
  anzahl     INT NOT NULL CHECK (anzahl > 0),
  PRIMARY KEY (schicht_id, rolle),
  CONSTRAINT fk_sr_schicht FOREIGN KEY (schicht_id) REFERENCES schicht(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_rolle FOREIGN KEY (rolle) REFERENCES rolle(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Eine Person hat pro Schicht höchstens einen Eintrag.
-- Kein Eintrag = Person wurde nicht gefragt.
-- person_id ist NULL, wenn die Person unbekannt ist.
CREATE TABLE anmeldung (
  id               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  schicht_id       INT NOT NULL,
  person_id        INT,
  name_text        VARCHAR(255) NOT NULL,    -- Name zum Zeitpunkt der Anmeldung (Archiv)
  email_text       VARCHAR(255),             -- nur bei unbekannten Personen
  status           VARCHAR(30) NOT NULL CHECK (status IN ('angemeldet','bestaetigt','abgemeldet','unsicher','nachricht_gesendet')),
  rolle            VARCHAR(100),
  kanal            VARCHAR(20) NOT NULL CHECK (kanal IN ('formular','telefon','whatsapp','muendlich')),
  bemerkung        TEXT,
  erstellt_am      VARCHAR(30) NOT NULL,
  geaendert_am     VARCHAR(30) NOT NULL,
  mail_gesendet_am VARCHAR(30),              -- leer = Bestätigungsmail noch offen
  UNIQUE KEY uq_anmeldung (schicht_id, person_id),
  CONSTRAINT fk_anm_schicht FOREIGN KEY (schicht_id) REFERENCES schicht(id) ON DELETE CASCADE,
  CONSTRAINT fk_anm_person FOREIGN KEY (person_id) REFERENCES person(clubdesk_id) ON DELETE SET NULL,
  CONSTRAINT fk_anm_rolle FOREIGN KEY (rolle) REFERENCES rolle(name),
  INDEX idx_anmeldung_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE status_log (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  anmeldung_id INT NOT NULL,
  zeit         VARCHAR(30) NOT NULL,
  benutzer_id  INT,                          -- NULL = Formular oder System
  aktion       VARCHAR(50) NOT NULL,         -- z. B. 'erstellt', 'status', 'rolle', 'kanal', 'bemerkung'
  alt_wert     TEXT,
  neu_wert     TEXT,
  CONSTRAINT fk_log_anmeldung FOREIGN KEY (anmeldung_id) REFERENCES anmeldung(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id),
  INDEX idx_log_anmeldung (anmeldung_id, zeit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Fremdabteilungen einer Schicht. Sie zählen als TN und beim Essen.
CREATE TABLE fremdabteilung (
  id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  schicht_id INT NOT NULL,
  name       VARCHAR(255) NOT NULL,
  anzahl     INT NOT NULL CHECK (anzahl > 0),
  bemerkung  TEXT,
  CONSTRAINT fk_fremd_schicht FOREIGN KEY (schicht_id) REFERENCES schicht(id) ON DELETE CASCADE,
  INDEX idx_fremdabteilung_schicht (schicht_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Merkt, ob ein ICS-Export für eine Schicht schon stattfand (Duplikat-Warnung)
CREATE TABLE ics_export (
  schicht_id    INT NOT NULL PRIMARY KEY,
  exportiert_am VARCHAR(30) NOT NULL,
  benutzer_id   INT,
  CONSTRAINT fk_ics_schicht FOREIGN KEY (schicht_id) REFERENCES schicht(id) ON DELETE CASCADE,
  CONSTRAINT fk_ics_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE mail_queue (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  an          VARCHAR(255) NOT NULL,
  reply_to    VARCHAR(255),
  betreff     VARCHAR(255) NOT NULL,
  text        MEDIUMTEXT NOT NULL,
  erstellt_am VARCHAR(30) NOT NULL,
  gesendet_am VARCHAR(30),
  fehler      TEXT,
  versuche    INT NOT NULL DEFAULT 0,
  naechster_versuch VARCHAR(30)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE import_log (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zeit        VARCHAR(30) NOT NULL,
  benutzer_id INT,
  dateiname   VARCHAR(255),
  neu         INT NOT NULL,
  geaendert   INT NOT NULL,
  entfernt    INT NOT NULL,
  CONSTRAINT fk_import_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Merkt den letzten Lauf der täglichen Jobs (ein Lauf pro Tag, auch nach einem Neustart).
CREATE TABLE job_lauf (
  name     VARCHAR(50) NOT NULL PRIMARY KEY,
  datum    VARCHAR(10) NOT NULL,             -- lokales Datum JJJJ-MM-TT
  zeit     VARCHAR(30) NOT NULL,
  ok       TINYINT NOT NULL,
  meldung  TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
