// Startet die App auf einem freien Port. Für Web-Tests (T19 und Rauchtest).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'mysql2/promise';
import { leseKonfiguration, type Konfiguration } from '../src/config.js';
import { erstelleApp, neueSitzung, csrfToken, type Abhaengigkeiten } from '../src/web/app.js';
import { schreibe } from '../src/db/db.js';

export const SECRET = 'test-geheimnis-test-geheimnis-test-geheimnis';

export interface TestApp {
  url: string;
  konfig: Konfiguration;
  stopp: () => Promise<void>;
}

export async function starteApp(db: Pool, env: Record<string, string> = {}, extra: Partial<Abhaengigkeiten> = {}): Promise<TestApp> {
  const konfig = leseKonfiguration({
    SESSION_SECRET: SECRET,
    ENTRA_TENANT_ID: 'mandant-test',
    ENTRA_CLIENT_ID: 'client-test',
    BASE_URL: 'http://localhost:3010',
    DATA_DIR: 'test-daten',
    EXPORT_DIR: 'test-export',
    ...env,
  });
  const app = erstelleApp({
    db,
    konfig,
    tagesexportJetzt: async () => ({ ok: true, meldung: 'ok' }),
    bestaetigungenJetzt: async () => ({ ok: true, meldung: 'ok' }),
    updater: null,
    ...extra,
  });
  const server: Server = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    konfig,
    stopp: () => new Promise((ok) => server.close(() => ok())),
  };
}

/** Legt einen Benutzer und eine Sitzung an. Gibt Cookie und CSRF-Token zurück. */
export async function anmelden(db: Pool, rolle: 'admin' | 'aufgebot' = 'admin'): Promise<{ cookie: string; csrf: string; benutzerId: number }> {
  const r = await schreibe(db, 'INSERT INTO benutzer (name, email, entra_oid, rolle, aktiv) VALUES (?, ?, ?, ?, 1)', [
    `Test ${rolle}`, `${rolle}@kkb.ch`, `oid-${rolle}`, rolle,
  ]);
  const sid = await neueSitzung(db, r.insertId);
  return { cookie: `sid=${sid}`, csrf: csrfToken(SECRET, sid), benutzerId: r.insertId };
}
