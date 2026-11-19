// Zugriff auf MySQL / MariaDB. Alle Abfragen nutzen Platzhalter (?), nie zusammengesetzten Text.
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type Db = Pool | PoolConnection;

export interface DbEinstellungen {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export function erstellePool(e: DbEinstellungen): Pool {
  return mysql.createPool({
    host: e.host,
    port: e.port,
    database: e.name,
    user: e.user,
    password: e.password,
    charset: 'utf8mb4_bin',
    // Bis rund 8 Benutzer arbeiten gleichzeitig. Dazu kommen Formular, Mail-Versand und Jobs.
    connectionLimit: 20,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    timezone: 'Z',
  });
}

/** Prüft, ob eine Verbindung mit diesen Werten möglich ist (Admin › Konfiguration). Wirft bei einem Fehler. */
export async function testeVerbindung(e: DbEinstellungen): Promise<void> {
  const c = await mysql.createConnection({
    host: e.host, port: e.port, database: e.name, user: e.user, password: e.password, connectTimeout: 5000,
  });
  await c.end();
}

const inTransaktion = new WeakSet<object>();

/**
 * Fehler, nach dem eine Transaktion neu starten darf.
 * Beispiel: Zwei Benutzer legen gleichzeitig denselben Eintrag an.
 */
export class Wiederholen extends Error {}

/** MySQL-Fehler bei gleichzeitigen Zugriffen: Deadlock oder Wartezeit auf eine Sperre. */
const SPERR_FEHLER = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/** So oft startet eine Transaktion höchstens, wenn sich zwei Benutzer gegenseitig blockieren. */
export const MAX_VERSUCHE = 4;

function darfWiederholen(fehler: unknown): boolean {
  if (fehler instanceof Wiederholen) return true;
  const code = (fehler as { code?: unknown })?.code;
  return typeof code === 'string' && SPERR_FEHLER.has(code);
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Liefert alle Zeilen einer Abfrage. */
export async function alle<T = Record<string, any>>(db: Db, sql: string, werte: unknown[] = []): Promise<T[]> {
  const [zeilen] = await db.query<RowDataPacket[]>(sql, werte);
  return zeilen as unknown as T[];
}

/** Liefert die erste Zeile oder undefined. */
export async function eine<T = Record<string, any>>(db: Db, sql: string, werte: unknown[] = []): Promise<T | undefined> {
  const zeilen = await alle<T>(db, sql, werte);
  return zeilen[0];
}

/** Führt eine Schreibabfrage aus. */
export async function schreibe(db: Db, sql: string, werte: unknown[] = []): Promise<ResultSetHeader> {
  const [ergebnis] = await db.query<ResultSetHeader>(sql, werte);
  return ergebnis;
}

/**
 * Führt fn in einer Transaktion aus (Regel 11.4.1).
 * Läuft schon eine Transaktion auf dieser Verbindung, nutzt fn diese.
 */
export async function transaktion<T>(db: Db, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  if (inTransaktion.has(db)) return fn(db as PoolConnection);
  // Mehrere Benutzer arbeiten gleichzeitig. Blockieren sich zwei Transaktionen,
  // bricht MySQL eine davon ab. Das Tool startet sie dann nach einer kurzen Pause neu.
  for (let versuch = 1; ; versuch++) {
    try {
      return await einmal(db, fn);
    } catch (fehler) {
      if (versuch >= MAX_VERSUCHE || !darfWiederholen(fehler)) throw fehler;
      await warte(20 * versuch + Math.floor(Math.random() * 30));
    }
  }
}

async function einmal<T>(db: Db, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const istVerbindung = typeof (db as PoolConnection).release === 'function';
  const c = istVerbindung ? (db as PoolConnection) : await (db as Pool).getConnection();
  inTransaktion.add(c);
  try {
    await c.beginTransaction();
    const ergebnis = await fn(c);
    await c.commit();
    return ergebnis;
  } catch (fehler) {
    await c.rollback().catch(() => undefined);
    throw fehler;
  } finally {
    inTransaktion.delete(c);
    if (!istVerbindung) c.release();
  }
}
