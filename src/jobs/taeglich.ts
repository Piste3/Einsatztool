// Tägliche Jobs: prüfen jede Minute die lokale Stunde und laufen einmal pro Tag (Entscheid Yann).
// Der letzte Lauf steht in job_lauf. So läuft ein Job auch nach einem Neustart nur einmal pro Tag.
import { eine, schreibe, type Db } from '../db/db.js';
import { jetztIso, lokalesDatum, lokaleStunde } from '../domain/zeit.js';
import { log } from '../log.js';

export interface TaeglicherJob {
  name: string;
  stunde: number;
  lauf: () => Promise<{ ok: boolean; meldung: string }>;
}

export interface LaufStand {
  datum: string;
  zeit: string;
  ok: number;
  meldung: string | null;
}

export async function letzterLauf(db: Db, name: string): Promise<LaufStand | undefined> {
  return eine<LaufStand>(db, 'SELECT datum, zeit, ok, meldung FROM job_lauf WHERE name = ?', [name]);
}

async function merke(db: Db, name: string, ok: boolean, meldung: string): Promise<void> {
  await schreibe(
    db,
    `INSERT INTO job_lauf (name, datum, zeit, ok, meldung) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE datum = VALUES(datum), zeit = VALUES(zeit), ok = VALUES(ok), meldung = VALUES(meldung)`,
    [name, lokalesDatum(new Date()), jetztIso(), ok ? 1 : 0, meldung.slice(0, 5000)],
  );
}

/** Führt einen Job aus und merkt das Ergebnis (auch für «jetzt auslösen»). */
/** Jobs, die gerade laufen. Ein Server-Prozess genügt, darum liegt die Liste im Speicher. */
const laufendeJobs = new Set<string>();

/** Meldung, wenn ein Job schon läuft (z. B. zwei Admins klicken gleichzeitig «jetzt auslösen»). */
export const LAEUFT_SCHON = 'Der Job läuft gerade schon. Warte, bis er fertig ist.';

export async function fuehreAus(db: Db, job: TaeglicherJob, automatisch: boolean): Promise<{ ok: boolean; meldung: string }> {
  // Ein Job läuft nie zweimal gleichzeitig. Der zweite Aufruf ändert nichts.
  if (laufendeJobs.has(job.name)) return { ok: false, meldung: LAEUFT_SCHON };
  laufendeJobs.add(job.name);
  let r: { ok: boolean; meldung: string };
  try {
    r = await job.lauf();
  } catch (e) {
    r = { ok: false, meldung: (e as Error).message };
  } finally {
    laufendeJobs.delete(job.name);
  }
  await merke(db, job.name, r.ok, r.meldung);
  if (automatisch) await merke(db, `${job.name}:auto`, r.ok, r.meldung);
  log(r.ok ? 'info' : 'error', `Job ${job.name}: ${r.meldung.replace(/\n/g, ' | ')}`);
  return r;
}

export async function pruefeJobs(db: Db, jobs: TaeglicherJob[], jetzt = new Date()): Promise<void> {
  const heute = lokalesDatum(jetzt);
  const stunde = lokaleStunde(jetzt);
  for (const job of jobs) {
    if (job.stunde !== stunde) continue;
    const letzter = await letzterLauf(db, `${job.name}:auto`);
    if (letzter?.datum === heute) continue;
    await fuehreAus(db, job, true);
  }
}

export function starteTaeglicheJobs(db: Db, jobs: TaeglicherJob[], jedeMinute: (() => Promise<void>)[] = []): () => void {
  let laeuft = false;
  const tick = async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      await pruefeJobs(db, jobs);
      for (const f of jedeMinute) await f();
    } catch (e) {
      log('error', `Tägliche Jobs: ${(e as Error).message}`);
    } finally {
      laeuft = false;
    }
  };
  const t = setInterval(() => void tick(), 60000);
  void tick();
  return () => clearInterval(t);
}
