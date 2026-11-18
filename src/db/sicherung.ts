// Datenbankkopie als SQL-Datei, ohne mysqldump (Entscheid Yann).
// Jede Anweisung steht auf genau einer Zeile. So kann wiederherstellen.ts die Datei Zeile für Zeile einspielen.
import { createWriteStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { alle, schreibe, type Db } from './db.js';

async function tabellen(db: Db): Promise<string[]> {
  const z = await alle<{ name: string }>(
    db,
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  return z.map((t) => t.name);
}

/** Schreibt alle Tabellen mit Struktur und Daten in eine SQL-Datei. */
export async function schreibeSicherung(db: Db, datei: string): Promise<void> {
  const aus = createWriteStream(datei, { encoding: 'utf8' });
  const zeile = async (s: string) => {
    if (!aus.write(s + '\n')) await once(aus, 'drain');
  };
  try {
    await zeile(`-- Einsatzplaner: Datenbankkopie vom ${new Date().toISOString()}`);
    await zeile('SET NAMES utf8mb4;');
    await zeile('SET FOREIGN_KEY_CHECKS = 0;');
    for (const t of await tabellen(db)) {
      if (!/^[a-z_]+$/.test(t)) continue;
      const [[erstellt]] = (await db.query(`SHOW CREATE TABLE \`${t}\``)) as any;
      const ddl = String(erstellt['Create Table']).replace(/\r?\n\s*/g, ' ');
      await zeile(`DROP TABLE IF EXISTS \`${t}\`;`);
      await zeile(`${ddl};`);
      const zeilen = await alle<Record<string, unknown>>(db, `SELECT * FROM \`${t}\``);
      for (let i = 0; i < zeilen.length; i += 200) {
        const teil = zeilen.slice(i, i + 200);
        const spalten = Object.keys(teil[0]);
        const werte = teil.map((r) => `(${spalten.map((s) => mysql.escape((r[s] ?? null) as any)).join(', ')})`).join(', ');
        await zeile(`INSERT INTO \`${t}\` (${spalten.map((s) => `\`${s}\``).join(', ')}) VALUES ${werte};`);
      }
    }
    await zeile('SET FOREIGN_KEY_CHECKS = 1;');
  } finally {
    aus.end();
    await once(aus, 'finish');
  }
}

/** Spielt eine SQL-Datei aus schreibeSicherung wieder ein. Ersetzt alle Tabellen. */
export async function spieleSicherungEin(db: Db, datei: string): Promise<number> {
  const text = readFileSync(datei, 'utf8');
  let n = 0;
  for (const roh of text.split('\n')) {
    const s = roh.trim();
    if (!s || s.startsWith('--')) continue;
    await schreibe(db, s.replace(/;$/, ''));
    n++;
  }
  return n;
}
