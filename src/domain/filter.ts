// Gespeicherte Filter je Benutzer und Liste (Wunsch Yann, 20.11.2026).
// Ein Aufruf mit Filtern in der Adresse speichert sie. Ein Aufruf ohne Filter nimmt die gespeicherten.
// «zuruecksetzen=1» löscht sie. Die Werte sind Einstellungen der Ansicht, keine Daten des Einsatzes.
// Darum läuft das Speichern ohne transaktion(): eine einzelne Anweisung, ohne Live-Meldung an andere Seiten.
import { eine, schreibe, type Db } from '../db/db.js';
import { jetztIso } from './zeit.js';

export type FilterListe = 'rueckmeldungen' | 'einsaetze' | 'archiv';

/** Höchstens so viele Zeichen je Wert. Längere Werte kürzt das Tool. */
const MAX_LAENGE = 100;

/** Nimmt aus der Adresse nur die erlaubten Schlüssel mit Text als Wert. */
export function filterAusAnfrage(query: Record<string, unknown>, schluessel: readonly string[]): Record<string, string> | null {
  const werte: Record<string, string> = {};
  let gefunden = false;
  for (const s of schluessel) {
    const w = query[s];
    if (typeof w === 'string') {
      werte[s] = w.slice(0, MAX_LAENGE);
      gefunden = true;
    }
  }
  return gefunden ? werte : null;
}

export async function ladeFilter(db: Db, benutzerId: number, liste: FilterListe): Promise<Record<string, string> | null> {
  const z = await eine<{ werte: string }>(db, 'SELECT werte FROM benutzer_filter WHERE benutzer_id = ? AND liste = ?', [benutzerId, liste]);
  if (!z) return null;
  try {
    const roh = JSON.parse(z.werte) as unknown;
    if (!roh || typeof roh !== 'object') return null;
    const werte: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) if (typeof v === 'string') werte[k] = v.slice(0, MAX_LAENGE);
    return werte;
  } catch {
    return null;
  }
}

export async function speichereFilter(db: Db, benutzerId: number, liste: FilterListe, werte: Record<string, string>): Promise<void> {
  await schreibe(
    db,
    `INSERT INTO benutzer_filter (benutzer_id, liste, werte, geaendert_am) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE werte = VALUES(werte), geaendert_am = VALUES(geaendert_am)`,
    [benutzerId, liste, JSON.stringify(werte), jetztIso()],
  );
}

export async function loescheFilter(db: Db, benutzerId: number, liste: FilterListe): Promise<void> {
  await schreibe(db, 'DELETE FROM benutzer_filter WHERE benutzer_id = ? AND liste = ?', [benutzerId, liste]);
}

/**
 * Bestimmt die Filter für eine Liste:
 * - «zuruecksetzen=1»: gespeicherte Filter löschen, Standard verwenden.
 * - Filter in der Adresse: verwenden und speichern.
 * - sonst: gespeicherte Filter verwenden (oder Standard).
 * Die Werte prüft danach die Route wie bisher.
 */
export async function filterFuerListe(
  db: Db,
  benutzerId: number,
  liste: FilterListe,
  query: Record<string, unknown>,
  schluessel: readonly string[],
  /** false bei Hintergrund-Abfragen (Live): Filter aus der Adresse gelten, das Tool speichert sie aber nicht. */
  speichern = true,
): Promise<{ werte: Record<string, unknown>; gespeichert: boolean }> {
  if (query.zuruecksetzen === '1' && speichern) {
    await loescheFilter(db, benutzerId, liste);
    return { werte: {}, gespeichert: false };
  }
  const neu = filterAusAnfrage(query, schluessel);
  if (neu) {
    if (speichern) await speichereFilter(db, benutzerId, liste, neu);
    return { werte: neu, gespeichert: true };
  }
  const alt = await ladeFilter(db, benutzerId, liste);
  return { werte: alt ?? {}, gespeichert: !!alt };
}
