// Spielt eine Datenbankkopie (datenbank-JJJJ-MM-TT.sql) ein. Ersetzt alle Tabellen.
// Aufruf: node dist/src/wiederherstellen.js <datei.sql> --bestaetigt
// Das Tool löscht nie Daten ohne Bestätigung. Ohne «--bestaetigt» ändert das Skript nichts.
// Vorher den Server stoppen. Vorher macht das Skript eine Sicherung des aktuellen Stands.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ladeEnvDatei, leseKonfiguration } from './config.js';
import { erstellePool } from './db/db.js';
import { schreibeSicherung, spieleSicherungEin } from './db/sicherung.js';

async function haupt(): Promise<void> {
  const [datei, schalter] = process.argv.slice(2);
  if (!datei) {
    console.log('Aufruf: node dist/src/wiederherstellen.js <datei.sql> --bestaetigt');
    process.exit(2);
  }
  const pfad = resolve(datei);
  if (!existsSync(pfad)) {
    console.error(`Datei nicht gefunden: ${pfad}`);
    process.exit(2);
  }
  ladeEnvDatei();
  const konfig = leseKonfiguration();
  if (schalter !== '--bestaetigt') {
    console.log(`Die Datei ${pfad} ersetzt alle Tabellen der Datenbank «${konfig.db.name}».`);
    console.log('Stoppe zuerst den Server. Starte das Skript dann mit «--bestaetigt».');
    process.exit(2);
  }
  const pool = erstellePool(konfig.db);
  try {
    const ordner = join(konfig.exportDir, 'update-sicherung');
    mkdirSync(ordner, { recursive: true });
    const vorher = join(ordner, `datenbank-vor-wiederherstellung-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
    await schreibeSicherung(pool, vorher);
    console.log(`Aktueller Stand gesichert: ${vorher}`);
    // Eine einzige Verbindung, damit SET FOREIGN_KEY_CHECKS für alle Anweisungen gilt.
    const verbindung = await pool.getConnection();
    try {
      const n = await spieleSicherungEin(verbindung, pfad);
      console.log(`Fertig: ${n} Anweisungen eingespielt.`);
    } finally {
      verbindung.release();
    }
  } finally {
    await pool.end();
  }
}

haupt().catch((e) => {
  console.error(`Fehler: ${(e as Error).message}`);
  process.exit(1);
});
