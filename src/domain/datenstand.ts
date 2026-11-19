// Datenstand eines Einsatzes: Ein kurzer Text, der sich bei jeder Änderung ändert.
// Die Seiten fragen ihn regelmässig ab. So sieht ein Benutzer Änderungen anderer Benutzer.
import { createHash } from 'node:crypto';
import { eine, type Db } from '../db/db.js';

/**
 * Liefert den Datenstand eines Einsatzes mit allen Schichten, Einträgen und Fremdabteilungen.
 * Ein gelöschter Einsatz hat den Stand «geloescht».
 */
export async function datenstandEinsatz(db: Db, einsatzId: number): Promise<string> {
  const z = await eine<Record<string, unknown>>(
    db,
    `SELECT e.version AS ev,
            (SELECT CONCAT_WS(':', COUNT(*), COALESCE(SUM(s.version), 0), COALESCE(SUM(s.publiziert), 0), COALESCE(MAX(s.id), 0))
               FROM schicht s WHERE s.einsatz_id = e.id) AS sch,
            (SELECT CONCAT_WS(':', COUNT(*), COALESCE(SUM(a.version), 0), COALESCE(MAX(a.id), 0), COALESCE(MAX(a.geaendert_am), ''))
               FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id WHERE s.einsatz_id = e.id) AS anm,
            (SELECT CONCAT_WS(':', COUNT(*), COALESCE(SUM(CRC32(CONCAT_WS('|', f.id, f.name, f.anzahl, COALESCE(f.bemerkung, '')))), 0))
               FROM fremdabteilung f JOIN schicht s ON s.id = f.schicht_id WHERE s.einsatz_id = e.id) AS fremd
       FROM einsatz e WHERE e.id = ?`,
    [einsatzId],
  );
  if (!z) return 'geloescht';
  const roh = [z.ev, z.sch, z.anm, z.fremd].map((x) => String(x ?? '')).join('/');
  return createHash('sha256').update(roh).digest('base64url').slice(0, 16);
}
