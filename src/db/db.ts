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
    connectionLimit: 10,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    timezone: 'Z',
  });
}

const inTransaktion = new WeakSet<object>();

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
