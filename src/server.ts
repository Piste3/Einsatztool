// Start des Einsatzplaners: ein einziger Prozess mit Web-Server und Jobs.
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { ausUmgebung, envDateiPfad, ladeEnvDatei, leseKonfiguration } from './config.js';
import { erstelleQuelle } from './domain/konfiguration.js';
import { erstellePool } from './db/db.js';
import { migriere } from './db/migrate.js';
import { schreibeSicherung } from './db/sicherung.js';
import { erstelleApp } from './web/app.js';
import { log } from './log.js';
import { bestaetigungslauf } from './domain/bestaetigung.js';
import { tagesexport } from './domain/export.js';
import { SharePoint, sharePointBereit } from './domain/sharepoint.js';
import { raeumeImportdateienAuf } from './domain/importdatei.js';
import { fuehreAus, starteTaeglicheJobs, type TaeglicherJob } from './jobs/taeglich.js';
import { starteMailWorker } from './jobs/mail-worker.js';
import { starteIcalCache } from './jobs/ical-cache.js';
import { NEUSTART_CODE, Updater } from './jobs/update.js';

async function start(): Promise<void> {
  ladeEnvDatei();
  const konfig = leseKonfiguration();
  if (process.env.DEV_LOGIN === '1' && !konfig.devLogin) {
    log('warn', 'DEV_LOGIN=1 ist gesetzt, aber unwirksam (nur mit NODE_ENV=development und ohne ENTRA_TENANT_ID).');
  }
  if (konfig.devLogin) log('warn', 'TEST-LOGIN AKTIV. Der Server lauscht nur auf 127.0.0.1. Nie auf dem Server verwenden.');
  mkdirSync(konfig.dataDir, { recursive: true });
  mkdirSync(konfig.exportDir, { recursive: true });

  const db = erstellePool(konfig.db);
  const version = await migriere(db);
  log('info', `Datenbank bereit (Schema-Version ${version}).`);

  const sharepoint = sharePointBereit({ ...konfig.entra, ...konfig.sharepoint })
    ? new SharePoint({ ...konfig.entra, ...konfig.sharepoint })
    : null;

  const exportJob: TaeglicherJob = {
    name: 'tagesexport',
    stunde: konfig.exportStunde,
    lauf: async () => {
      const r = await tagesexport(db, konfig.exportDir, sharepoint);
      return { ok: r.ok, meldung: r.meldungen.join('\n') };
    },
  };
  const bestaetigungJob: TaeglicherJob = {
    name: 'bestaetigungsmail',
    stunde: konfig.bestaetigungStunde,
    lauf: async () => {
      const r = await bestaetigungslauf(db, konfig.mailFrom);
      return { ok: true, meldung: `${r.mails} Mails für ${r.eintraege} Einträge in der Warteschlange. ${r.ohneAdresse} ohne Adresse.` };
    },
  };

  let server: Server | null = null;
  const stopper: (() => void)[] = [];
  let beendet = false;
  const beenden = (code: number) => {
    if (beendet) return;
    beendet = true;
    log('info', `Server beendet sich (Code ${code}).`);
    for (const s of stopper) s();
    const fertig = () => void db.end().finally(() => process.exit(code));
    if (server) server.close(fertig);
    else fertig();
    setTimeout(() => process.exit(code), 10000).unref();
  };

  const ordner = dirname(fileURLToPath(import.meta.url));
  const appDir = join(ordner, '..', '..');
  const updater = konfig.updateErlaubt
    ? new Updater({
        appDir,
        dataDir: konfig.dataDir,
        exportDir: konfig.exportDir,
        branch: konfig.updateBranch,
        sichern: (datei) => schreibeSicherung(db, datei),
        neustart: () => beenden(NEUSTART_CODE),
      })
    : null;

  const app = erstelleApp({
    db,
    konfig,
    tagesexportJetzt: () => fuehreAus(db, exportJob, false),
    bestaetigungenJetzt: () => fuehreAus(db, bestaetigungJob, false),
    updater,
    konfigQuelle: erstelleQuelle(envDateiPfad(), process.env, ausUmgebung),
    neustart: () => beenden(NEUSTART_CODE),
  });

  server = app.listen(konfig.port, konfig.listenHost, () => {
    log('info', `Einsatzplaner läuft auf http://${konfig.listenHost}:${konfig.port} (öffentlich: ${konfig.baseUrl}).`);
  });
  server.on('error', (e) => {
    log('error', `Server-Fehler: ${e.message}`);
    process.exit(1);
  });

  stopper.push(starteMailWorker(db, konfig));
  stopper.push(starteIcalCache(konfig.clubdeskIcalUrl));
  stopper.push(
    starteTaeglicheJobs(db, [exportJob, bestaetigungJob], [
      async () => {
        raeumeImportdateienAuf(konfig.dataDir);
      },
    ]),
  );

  // Sauber beenden bei SIGTERM, SIGINT und SIGBREAK (Windows).
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGBREAK'] as const) {
    process.on(signal, () => beenden(0));
  }
  // stop.cmd und stop.sh legen die Stopp-Datei an. Unter SYSTEM ohne Konsole gibt es kein Signal.
  const stoppDatei = process.env.STOP_DATEI;
  if (stoppDatei) {
    const t = setInterval(() => {
      if (existsSync(stoppDatei)) {
        log('info', 'Stopp-Datei gefunden.');
        beenden(0);
      }
    }, 1000);
    t.unref();
    stopper.push(() => clearInterval(t));
  }
}

start().catch((e) => {
  log('error', `Start fehlgeschlagen: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
