// Legt das Schema an und führt Migrationen aus. Wiederholte Starts ändern nichts (22.3.2).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alle, schreibe, type Db } from './db.js';
import { seed } from './seed.js';

const ordner = dirname(fileURLToPath(import.meta.url));

/** Teilt eine SQL-Datei in einzelne Anweisungen. Eine Anweisung endet mit «;» am Zeilenende. */
export function teileSql(text: string): string[] {
  const ohneKommentare = text
    .split(/\r?\n/)
    .filter((z) => !z.trim().startsWith('--'))
    .join('\n');
  return ohneKommentare
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Migrationen in Reihenfolge. Version 1 ist das Grundschema. */
const migrationen: { version: number; anweisungen: () => string[] }[] = [
  { version: 1, anweisungen: () => teileSql(readFileSync(join(ordner, 'schema.sql'), 'utf8')) },
  // Version 2: Mehrere Benutzer arbeiten gleichzeitig. Die Spalte «version» zählt jede Änderung.
  // So erkennt das Tool, wenn ein Formular auf einem veralteten Stand beruht.
  {
    version: 2,
    anweisungen: () => [
      'ALTER TABLE einsatz ADD COLUMN version INT NOT NULL DEFAULT 1',
      'ALTER TABLE schicht ADD COLUMN version INT NOT NULL DEFAULT 1',
      'ALTER TABLE anmeldung ADD COLUMN version INT NOT NULL DEFAULT 1',
    ],
  },
  // Version 3: Protokoll der Konfiguration (Admin › Konfiguration). Geheimnisse stehen nie im Klartext darin.
  {
    version: 3,
    anweisungen: () => [
      `CREATE TABLE konfiguration_protokoll (
        id INT AUTO_INCREMENT PRIMARY KEY,
        zeit VARCHAR(30) NOT NULL,
        benutzer_id INT,
        schluessel VARCHAR(100) NOT NULL,
        alt TEXT,
        neu TEXT,
        CONSTRAINT fk_konfig_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ],
  },
  // Version 4 (Wunsch Yann): Ein neuer Einsatz braucht nur das Datum. Fehlen Zeiten, ist die Zeit «offen».
  // Das Tool speichert dann 00:00 bzw. 23:59 und zeigt «Zeit offen», bis jemand die Zeiten einträgt.
  {
    version: 4,
    anweisungen: () => ['ALTER TABLE schicht ADD COLUMN zeit_offen TINYINT NOT NULL DEFAULT 0'],
  },
  // Version 5: Vorlagen, die ein Admin in den Einstellungen bearbeitet (z. B. «Änderung melden»).
  // Ohne Zeile gilt die Standardvorlage aus dem Code.
  {
    version: 5,
    anweisungen: () => [
      `CREATE TABLE vorlage (
        schluessel VARCHAR(50) NOT NULL PRIMARY KEY,
        betreff TEXT NOT NULL,
        text TEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        geaendert_am VARCHAR(30) NOT NULL,
        geaendert_von INT,
        CONSTRAINT fk_vorlage_benutzer FOREIGN KEY (geaendert_von) REFERENCES benutzer(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ],
  },
  // Version 6 (Wunsch Yann): Jeder Benutzer behält seine Filter je Liste (z. B. Rückmeldungen, Einsätze).
  {
    version: 6,
    anweisungen: () => [
      `CREATE TABLE benutzer_filter (
        benutzer_id INT NOT NULL,
        liste VARCHAR(50) NOT NULL,
        werte TEXT NOT NULL,
        geaendert_am VARCHAR(30) NOT NULL,
        PRIMARY KEY (benutzer_id, liste),
        CONSTRAINT fk_filter_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ],
  },
  // Version 7 (Wunsch Yann 20.11.2026): Jedes Ausfüllen des Formulars als Eingang, mit den gewählten Schichten.
  // Ältere Formular-Anmeldungen trägt die Migration nach (gleiche Zeit und gleicher Name = ein Eingang, ohne Bemerkung).
  {
    version: 7,
    anweisungen: () => [
      `CREATE TABLE formular_eingang (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        zeit VARCHAR(30) NOT NULL,
        name VARCHAR(255),
        person_id INT,
        treffer VARCHAR(255),
        nachgetragen TINYINT NOT NULL DEFAULT 0,
        CONSTRAINT fk_eingang_person FOREIGN KEY (person_id) REFERENCES person(clubdesk_id) ON DELETE SET NULL,
        INDEX idx_eingang_zeit (zeit)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      `CREATE TABLE formular_eingang_schicht (
        eingang_id INT NOT NULL,
        schicht_id INT NOT NULL,
        anmeldung_id INT,
        neu TINYINT NOT NULL DEFAULT 1,
        bemerkung TEXT,
        PRIMARY KEY (eingang_id, schicht_id),
        CONSTRAINT fk_fes_eingang FOREIGN KEY (eingang_id) REFERENCES formular_eingang(id) ON DELETE CASCADE,
        CONSTRAINT fk_fes_schicht FOREIGN KEY (schicht_id) REFERENCES schicht(id) ON DELETE CASCADE,
        CONSTRAINT fk_fes_anmeldung FOREIGN KEY (anmeldung_id) REFERENCES anmeldung(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      `INSERT INTO formular_eingang (zeit, name, person_id, nachgetragen)
         SELECT DISTINCT erstellt_am, name_text, person_id, 1 FROM anmeldung WHERE kanal = 'formular'`,
      `INSERT IGNORE INTO formular_eingang_schicht (eingang_id, schicht_id, anmeldung_id, neu)
         SELECT e.id, a.schicht_id, a.id, 1 FROM anmeldung a
           JOIN formular_eingang e ON e.zeit = a.erstellt_am AND e.name = a.name_text AND e.person_id <=> a.person_id
          WHERE a.kanal = 'formular'`,
    ],
  },
  // Version 8 (Wunsch Yann 20.11.2026): Tenue-Vorlagen. Schicht und Einsatz kopieren den Text, sie verweisen nicht darauf.
  {
    version: 8,
    anweisungen: () => [
      `CREATE TABLE tenue_vorlage (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        text VARCHAR(255) NOT NULL,
        reihenfolge INT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_tenue_vorlage_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ],
  },
  {
    // Einstellung je Einsatz: Im Formular mehrere Schichten wählbar (1) oder nur eine (0).
    version: 9,
    anweisungen: () => ['ALTER TABLE einsatz ADD COLUMN formular_mehrere TINYINT NOT NULL DEFAULT 1'],
  },
  // Version 10 (Wunsch Yann 23.11.2026): Momentaufnahme je Eingang. «formular» = die sichtbaren Schichten
  // und die gewählten Schichten beim Absenden (ohne Personendaten). «eingabe» = Name und Bemerkungen, wie eingegeben.
  // Ältere Eingänge haben keine Momentaufnahme. Die Ansicht rekonstruiert sie und kennzeichnet das.
  {
    version: 10,
    anweisungen: () => [
      'ALTER TABLE formular_eingang ADD COLUMN formular MEDIUMTEXT NULL, ADD COLUMN eingabe TEXT NULL',
    ],
  },
  // Version 11 (Wunsch Yann 24.11.2026): Eine Tenue-Vorlage ist der Standard. Ein neuer Einsatz übernimmt ihren Text.
  {
    version: 11,
    anweisungen: () => ['ALTER TABLE tenue_vorlage ADD COLUMN standard TINYINT NOT NULL DEFAULT 0'],
  },
  // Version 12 (Wunsch Yann 26.11.2026): Protokoll für Einsatz und Schichten. Der Reiter «Verlauf» zeigt es.
  // schicht_id hat keinen Fremdschlüssel: Der Eintrag bleibt, wenn jemand die Schicht löscht.
  {
    version: 12,
    anweisungen: () => [
      `CREATE TABLE einsatz_protokoll (
        id INT AUTO_INCREMENT PRIMARY KEY,
        zeit VARCHAR(30) NOT NULL,
        einsatz_id INT NOT NULL,
        schicht_id INT NULL,
        schicht_name VARCHAR(255) NULL,
        benutzer_id INT NULL,
        aktion VARCHAR(40) NOT NULL,
        feld VARCHAR(100) NULL,
        alt TEXT NULL,
        neu TEXT NULL,
        INDEX idx_einsatz_protokoll (einsatz_id, zeit),
        CONSTRAINT fk_einsatz_protokoll_einsatz FOREIGN KEY (einsatz_id) REFERENCES einsatz(id) ON DELETE CASCADE,
        CONSTRAINT fk_einsatz_protokoll_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ],
  },
  // Version 13 (Wunsch Yann 26.11.2026): Je Rang ein Schalter «Aufgebot». Aus = keine Briefe für Personen mit diesem Rang.
  {
    version: 13,
    anweisungen: () => ['ALTER TABLE rang ADD COLUMN aufgebot TINYINT NOT NULL DEFAULT 1'],
  },
  // Version 14 (Wunsch Yann 26.11.2026): Einstellungen im Tool, z. B. Schalter «Bestätigungsmails».
  // Ohne Zeile gilt die Vorgabe im Code.
  {
    version: 14,
    anweisungen: () => [
      `CREATE TABLE einstellung (
        schluessel VARCHAR(50) NOT NULL PRIMARY KEY,
        wert TEXT NOT NULL,
        geaendert_am VARCHAR(30) NOT NULL,
        geaendert_von INT,
        CONSTRAINT fk_einstellung_benutzer FOREIGN KEY (geaendert_von) REFERENCES benutzer(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
      // Von Hand ausgelöste Mails gehen auch bei ausgeschalteten Bestätigungsmails weg.
      'ALTER TABLE mail_queue ADD COLUMN manuell TINYINT NOT NULL DEFAULT 0',
    ],
  },
];

export async function migriere(db: Db): Promise<number> {
  await schreibe(
    db,
    'CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin',
  );
  const zeilen = await alle<{ version: number }>(db, 'SELECT version FROM schema_version');
  let version = zeilen.length ? Number(zeilen[0].version) : 0;
  if (!zeilen.length) await schreibe(db, 'INSERT INTO schema_version (version) VALUES (0)');
  for (const m of migrationen) {
    if (m.version <= version) continue;
    // DDL-Anweisungen schliessen in MySQL jede Transaktion. Darum laufen sie einzeln.
    for (const sql of m.anweisungen()) await schreibe(db, sql);
    await schreibe(db, 'UPDATE schema_version SET version = ?', [m.version]);
    version = m.version;
  }
  await seed(db);
  return version;
}
