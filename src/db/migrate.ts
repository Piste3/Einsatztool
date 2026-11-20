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
