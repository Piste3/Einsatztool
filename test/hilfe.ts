// Hilfen für die Tests. Jeder Test legt eine eigene Datenbank an und löscht sie danach.
// Verbindung: TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD.
// Der Benutzer braucht das Recht, Datenbanken anzulegen und zu löschen.
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { erstellePool, schreibe } from '../src/db/db.js';
import { migriere } from '../src/db/migrate.js';
import { erstelleEinsatz } from '../src/domain/einsatz.js';
import { isoUtc, lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

export const TEST_DB = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'einsatzplaner_test',
  password: process.env.TEST_DB_PASSWORD || '',
};

export interface TestDb {
  db: Pool;
  name: string;
  ende: () => Promise<void>;
}

export async function neueDatenbank(): Promise<TestDb> {
  const name = `ep_test_${randomBytes(6).toString('hex')}`;
  const admin = await mysql.createConnection({ ...TEST_DB });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await admin.end();
  const db = erstellePool({ ...TEST_DB, name });
  await migriere(db);
  return {
    db,
    name,
    ende: async () => {
      await db.end();
      const a = await mysql.createConnection({ ...TEST_DB });
      await a.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await a.end();
    },
  };
}

/** Zeitpunkt in n Tagen (UTC ISO), zur vollen Stunde. */
export function inTagen(tage: number, stunde = 8): Date {
  const d = new Date(Date.now() + tage * 86400000);
  d.setUTCHours(stunde, 0, 0, 0);
  return d;
}

/** Erstellt einen Einsatz mit Start und Ende als Date. Gibt Einsatz- und Schicht-ID zurück. */
export async function einsatz(db: Pool, name: string, start: Date, ende: Date, ort: string | null = null): Promise<{ einsatzId: number; schichtId: number }> {
  const einsatzId = await erstelleEinsatz(
    db,
    {
      name,
      start_datum: lokalesDatum(start),
      start_zeit: lokaleZeit(start),
      end_datum: lokalesDatum(ende),
      end_zeit: lokaleZeit(ende),
      ort: ort ?? '',
    },
    null,
  );
  const [z] = (await db.query('SELECT id FROM schicht WHERE einsatz_id = ?', [einsatzId])) as any;
  return { einsatzId, schichtId: z[0].id };
}

export async function person(
  db: Pool,
  id: number,
  daten: Partial<{ vorname: string; nachname: string; geburtsdatum: string; rang_id: number; email: string; telefon: string; strasse: string; plz: string; ort: string; essenseinschraenkung: string }> = {},
): Promise<number> {
  await schreibe(
    db,
    `INSERT INTO person (clubdesk_id, vorname, nachname, geburtsdatum, rang_id, email, telefon, strasse, plz, ort, essenseinschraenkung, importiert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, daten.vorname ?? `Vorname${id}`, daten.nachname ?? `Nachname${id}`, daten.geburtsdatum ?? null, daten.rang_id ?? null,
      daten.email ?? null, daten.telefon ?? null, daten.strasse ?? null, daten.plz ?? null, daten.ort ?? null,
      daten.essenseinschraenkung ?? null, isoUtc(new Date()),
    ],
  );
  return id;
}

export async function rang(db: Pool, name: string, reihenfolge: number): Promise<number> {
  const r = await schreibe(db, 'INSERT INTO rang (name, reihenfolge) VALUES (?, ?)', [name, reihenfolge]);
  return r.insertId;
}

export async function zeilen<T = any>(db: Pool, sql: string, werte: unknown[] = []): Promise<T[]> {
  const [z] = (await db.query(sql, werte)) as any;
  return z as T[];
}
