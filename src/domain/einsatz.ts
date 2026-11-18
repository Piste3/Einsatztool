// Einsätze: erstellen, ändern mit Vererbung, kopieren, löschen, Archiv (13.1, 13.3, 13.9, 21).
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, NichtGefunden, pflichtText, text } from './eingabe.js';
import {
  istDatum,
  istZeit,
  jetztIso,
  lokalZuUtc,
  lokalesDatum,
  lokaleZeit,
  plusTage,
  tageZwischen,
} from './zeit.js';
import { zahlenFuerSchichten } from './zaehlung.js';

export interface Einsatz {
  id: number;
  name: string;
  ort: string | null;
  bemerkung_intern: string | null;
  bemerkung_extern: string | null;
  erstellt_am: string;
  erstellt_von: number | null;
  abtreten_ort: string | null;
  tenue: string | null;
  aufgebot_hinweis: string | null;
}

/** Liest Start oder Ende aus Datum und Zeit (lokal) und gibt UTC zurück. */
export function zeitpunkt(datum: unknown, zeit: unknown, feld: string): string {
  const d = typeof datum === 'string' ? datum.trim() : '';
  const z = typeof zeit === 'string' ? zeit.trim() : '';
  if (!istDatum(d)) throw new Eingabefehler(`${feld}: Datum fehlt oder ist ungültig.`);
  if (!istZeit(z)) throw new Eingabefehler(`${feld}: Zeit fehlt oder ist ungültig.`);
  return lokalZuUtc(d, z);
}

export interface EinsatzNeu {
  name: unknown;
  start_datum: unknown;
  start_zeit: unknown;
  end_datum: unknown;
  end_zeit: unknown;
  ort?: unknown;
}

/**
 * Regel 13.1: Einsatz mit Name, Start, Ende und optional Ort erstellen.
 * Das Tool legt automatisch eine Standardschicht an (Name des Einsatzes, publiziert = 1).
 */
export async function erstelleEinsatz(db: Db, e: EinsatzNeu, benutzerId: number | null): Promise<number> {
  const name = pflichtText(e.name, 'Name');
  const ort = text(e.ort, 'Ort');
  const start = zeitpunkt(e.start_datum, e.start_zeit, 'Start');
  const ende = zeitpunkt(e.end_datum, e.end_zeit, 'Ende');
  if (ende <= start) throw new Eingabefehler('Das Ende muss nach dem Start liegen.');
  return transaktion(db, async (c) => {
    const r = await schreibe(c, 'INSERT INTO einsatz (name, ort, erstellt_am, erstellt_von) VALUES (?, ?, ?, ?)', [
      name,
      ort,
      jetztIso(),
      benutzerId,
    ]);
    const einsatzId = r.insertId;
    await schreibe(
      c,
      'INSERT INTO schicht (einsatz_id, name, start_zeit, end_zeit, ort, publiziert, position) VALUES (?, ?, ?, ?, ?, 1, 0)',
      [einsatzId, name, start, ende, ort],
    );
    return einsatzId;
  });
}

export async function ladeEinsatz(db: Db, id: number): Promise<Einsatz> {
  const e = await eine<Einsatz>(db, 'SELECT * FROM einsatz WHERE id = ?', [id]);
  if (!e) throw new NichtGefunden('Einsatz nicht gefunden.');
  return e;
}

/** Felder, die vom Einsatz auf die Schichten vererbt werden (13.3.4, 20.1). */
export const VERERBTE_FELDER = ['ort', 'abtreten_ort', 'tenue', 'aufgebot_hinweis'] as const;

export interface EinsatzAenderung {
  name: unknown;
  ort?: unknown;
  bemerkung_intern?: unknown;
  bemerkung_extern?: unknown;
  abtreten_ort?: unknown;
  tenue?: unknown;
  aufgebot_hinweis?: unknown;
}

/**
 * Einsatz ändern. Regel 13.3: Ändert sich ein vererbtes Feld von A auf B,
 * ersetzt das Tool den Wert in allen Schichten mit genau A. Andere Schichten bleiben.
 */
export async function aendereEinsatz(db: Db, id: number, a: EinsatzAenderung): Promise<void> {
  const neu = {
    name: pflichtText(a.name, 'Name'),
    ort: text(a.ort, 'Ort'),
    bemerkung_intern: text(a.bemerkung_intern, 'Bemerkung intern', 5000),
    bemerkung_extern: text(a.bemerkung_extern, 'Bemerkung extern', 5000),
    abtreten_ort: text(a.abtreten_ort, 'Ort Abtreten'),
    tenue: text(a.tenue, 'Tenue'),
    aufgebot_hinweis: text(a.aufgebot_hinweis, 'Hinweis Aufgebot', 2000),
  };
  await transaktion(db, async (c) => {
    const alt = await eine<Einsatz>(c, 'SELECT * FROM einsatz WHERE id = ? FOR UPDATE', [id]);
    if (!alt) throw new NichtGefunden('Einsatz nicht gefunden.');
    for (const feld of VERERBTE_FELDER) {
      const vorher = alt[feld];
      const nachher = neu[feld];
      if (vorher === nachher) continue;
      // Schichten mit genau dem alten Wert übernehmen den neuen Wert. NULL gilt als gleich NULL.
      await schreibe(c, `UPDATE schicht SET ${feld} = ? WHERE einsatz_id = ? AND ${feld} <=> ?`, [nachher, id, vorher]);
    }
    await schreibe(
      c,
      `UPDATE einsatz SET name = ?, ort = ?, bemerkung_intern = ?, bemerkung_extern = ?,
         abtreten_ort = ?, tenue = ?, aufgebot_hinweis = ? WHERE id = ?`,
      [neu.name, neu.ort, neu.bemerkung_intern, neu.bemerkung_extern, neu.abtreten_ort, neu.tenue, neu.aufgebot_hinweis, id],
    );
  });
}

/** Zahl der Anmeldungen eines Einsatzes (für die Bestätigung beim Löschen). */
export async function anzahlAnmeldungenEinsatz(db: Db, id: number): Promise<number> {
  const z = await eine<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id WHERE s.einsatz_id = ?',
    [id],
  );
  return Number(z?.n ?? 0);
}

/** Regel 21.3: Einsatz löschen. Die Route verlangt vorher eine Bestätigung. */
export async function loescheEinsatz(db: Db, id: number): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'DELETE FROM einsatz WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Einsatz nicht gefunden.');
  });
}

/** Frühestes lokales Startdatum eines Einsatzes. */
async function erstesDatum(db: Db, id: number): Promise<string> {
  const z = await eine<{ s: string | null }>(db, 'SELECT MIN(start_zeit) AS s FROM schicht WHERE einsatz_id = ?', [id]);
  if (!z?.s) throw new Eingabefehler('Der Einsatz hat keine Schicht.');
  return lokalesDatum(z.s);
}

/**
 * Vorgabe für die Kopie (Entscheid Yann): Die erste Jahreszahl im Namen steigt um eins.
 * Startdatum = derselbe Tag im nächsten Jahr.
 */
export function vorgabeName(name: string): string {
  return name.replace(/\b(19|20)\d{2}\b/, (j) => String(Number(j) + 1));
}

export async function vorgabeKopie(db: Db, id: number): Promise<{ name: string; startDatum: string }> {
  const e = await ladeEinsatz(db, id);
  const datum = await erstesDatum(db, id);
  const [j, m, t] = datum.split('-');
  let neu = `${Number(j) + 1}-${m}-${t}`;
  // 29. Februar gibt es nicht in jedem Jahr.
  if (!istDatum(neu)) neu = `${Number(j) + 1}-${m}-28`;
  return { name: vorgabeName(e.name), startDatum: neu };
}

/**
 * Regel 21.1: Einsatz kopieren. Zeiten um die Tage verschieben, lokale Uhrzeit bleibt.
 * Alle Schichten sind unpubliziert. Keine Anmeldungen, Fremdabteilungen oder ICS-Vermerke.
 */
export async function kopiereEinsatz(
  db: Db,
  id: number,
  eingabe: { name: unknown; start_datum: unknown },
  benutzerId: number | null,
): Promise<number> {
  const name = pflichtText(eingabe.name, 'Name');
  const startDatum = typeof eingabe.start_datum === 'string' ? eingabe.start_datum.trim() : '';
  if (!istDatum(startDatum)) throw new Eingabefehler('Startdatum fehlt oder ist ungültig.');
  return transaktion(db, async (c) => {
    const e = await ladeEinsatz(c, id);
    const tage = tageZwischen(await erstesDatum(c, id), startDatum);
    const r = await schreibe(
      c,
      `INSERT INTO einsatz (name, ort, bemerkung_intern, bemerkung_extern, erstellt_am, erstellt_von,
         abtreten_ort, tenue, aufgebot_hinweis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, e.ort, e.bemerkung_intern, e.bemerkung_extern, jetztIso(), benutzerId, e.abtreten_ort, e.tenue, e.aufgebot_hinweis],
    );
    const neuId = r.insertId;
    const schichten = await alle<any>(c, 'SELECT * FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit, id', [id]);
    for (const s of schichten) {
      const start = lokalZuUtc(plusTage(lokalesDatum(s.start_zeit), tage), lokaleZeit(s.start_zeit));
      const ende = lokalZuUtc(plusTage(lokalesDatum(s.end_zeit), tage), lokaleZeit(s.end_zeit));
      const rs = await schreibe(
        c,
        `INSERT INTO schicht (einsatz_id, name, start_zeit, end_zeit, ort, min_alter, min_rang_id, soll_anzahl,
           abtreten_ort, tenue, aufgebot_hinweis, bemerkung_intern, bemerkung_extern, publiziert, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          neuId, s.name, start, ende, s.ort, s.min_alter, s.min_rang_id, s.soll_anzahl, s.abtreten_ort, s.tenue,
          s.aufgebot_hinweis, s.bemerkung_intern, s.bemerkung_extern, s.position,
        ],
      );
      await schreibe(
        c,
        'INSERT INTO schicht_rolle (schicht_id, rolle, anzahl) SELECT ?, rolle, anzahl FROM schicht_rolle WHERE schicht_id = ?',
        [rs.insertId, s.id],
      );
    }
    return neuId;
  });
}

export interface EinsatzZeile {
  id: number;
  name: string;
  ort: string | null;
  start: string;
  ende: string;
  schichten: number;
  teilnehmende: number;
  unbestaetigt: number;
  soll: number | null;
}

/**
 * Liste der Einsätze. «kommend»: letzte Schicht endet in der Zukunft.
 * «archiv»: vergangene Einsätze, neueste zuerst (13.9, 21.2).
 */
export async function einsatzListe(db: Db, ansicht: 'kommend' | 'archiv'): Promise<EinsatzZeile[]> {
  const jetzt = jetztIso();
  const zeilen = await alle<any>(
    db,
    `SELECT e.id, e.name, e.ort, MIN(s.start_zeit) AS start, MAX(s.end_zeit) AS ende, COUNT(s.id) AS schichten
       FROM einsatz e JOIN schicht s ON s.einsatz_id = e.id
      GROUP BY e.id, e.name, e.ort
     HAVING ${ansicht === 'kommend' ? 'MAX(s.end_zeit) > ?' : 'MAX(s.end_zeit) <= ?'}
      ORDER BY ${ansicht === 'kommend' ? 'start ASC' : 'start DESC'}`,
    [jetzt],
  );
  if (!zeilen.length) return [];
  const schichten = await alle<{ id: number; einsatz_id: number; soll_anzahl: number | null }>(
    db,
    'SELECT id, einsatz_id, soll_anzahl FROM schicht WHERE einsatz_id IN (?)',
    [zeilen.map((z) => z.id)],
  );
  const zahlen = await zahlenFuerSchichten(db, schichten.map((s) => s.id));
  return zeilen.map((z) => {
    const eigene = schichten.filter((s) => s.einsatz_id === z.id);
    let tn = 0;
    let unb = 0;
    let soll: number | null = null;
    for (const s of eigene) {
      const zs = zahlen.get(s.id);
      // Archiv-Zahl: Summe der Teilnehmenden über alle Schichten (Entscheid Yann).
      tn += zs?.teilnehmende ?? 0;
      unb += zs?.unbestaetigt ?? 0;
      if (s.soll_anzahl !== null) soll = (soll ?? 0) + s.soll_anzahl;
    }
    return {
      id: z.id, name: z.name, ort: z.ort, start: z.start, ende: z.ende, schichten: Number(z.schichten),
      teilnehmende: tn, unbestaetigt: unb, soll,
    };
  });
}
