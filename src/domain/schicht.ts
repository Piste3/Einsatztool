// Schichten: hinzufügen, ändern, publizieren, löschen, Fremdabteilungen (13.2, 13.4, 5.10).
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, NichtGefunden, ganzzahl, pflichtText, pruefeVersion, text } from './eingabe.js';
import { zeitpunkt, ladeEinsatz } from './einsatz.js';
import { jetztIso, lokalesDatum, lokaleZeit, plusTage } from './zeit.js';

export interface Schicht {
  id: number;
  einsatz_id: number;
  name: string;
  start_zeit: string;
  end_zeit: string;
  ort: string | null;
  min_alter: number | null;
  min_rang_id: number | null;
  soll_anzahl: number | null;
  abtreten_ort: string | null;
  tenue: string | null;
  aufgebot_hinweis: string | null;
  bemerkung_intern: string | null;
  bemerkung_extern: string | null;
  publiziert: number;
  position: number;
  /** 1 = Beginn oder Ende fehlt noch (gespeichert als 00:00 bzw. 23:59). */
  zeit_offen: number;
  /** Zählt jede Änderung im Formular «Schicht bearbeiten». */
  version: number;
}

export interface SchichtMitEinsatz extends Schicht {
  einsatz_name: string;
  einsatz_bemerkung_extern: string | null;
  /** Zahl der Schichten im Einsatz (für Termin-Titel und Aufgebot). */
  anzahl_schichten: number;
  min_rang_name: string | null;
  min_rang_reihenfolge: number | null;
}

export async function ladeSchicht(db: Db, id: number): Promise<SchichtMitEinsatz> {
  const s = await eine<SchichtMitEinsatz>(
    db,
    `SELECT s.*, e.name AS einsatz_name, e.bemerkung_extern AS einsatz_bemerkung_extern,
            (SELECT COUNT(*) FROM schicht x WHERE x.einsatz_id = s.einsatz_id) AS anzahl_schichten,
            r.name AS min_rang_name, r.reihenfolge AS min_rang_reihenfolge
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id LEFT JOIN rang r ON r.id = s.min_rang_id
      WHERE s.id = ?`,
    [id],
  );
  if (!s) throw new NichtGefunden('Schicht nicht gefunden.');
  s.anzahl_schichten = Number(s.anzahl_schichten);
  return s;
}

/** Schichten eines Einsatzes, nach Startzeit sortiert (13.2.3). */
export async function schichtenVonEinsatz(db: Db, einsatzId: number): Promise<Schicht[]> {
  return alle<Schicht>(db, 'SELECT * FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit, position, id', [einsatzId]);
}

export interface SchichtEingabe {
  name: unknown;
  start_datum: unknown;
  start_zeit: unknown;
  end_datum: unknown;
  end_zeit: unknown;
  ort?: unknown;
  abtreten_ort?: unknown;
  tenue?: unknown;
  aufgebot_hinweis?: unknown;
  min_alter?: unknown;
  min_rang_id?: unknown;
  soll_anzahl?: unknown;
  bemerkung_intern?: unknown;
  bemerkung_extern?: unknown;
  /** Rollenbedarf: Name der Rolle → Anzahl (leer oder 0 = kein Bedarf). */
  rollen?: Record<string, unknown>;
  /** Version, die das Formular angezeigt hat. Leer = keine Prüfung. */
  version?: unknown;
}

async function pruefeRang(db: Db, wert: unknown): Promise<number | null> {
  const rangId = ganzzahl(wert, 'Mindestrang', 1, 2_147_483_647);
  if (rangId === null) return null;
  const r = await eine(db, 'SELECT id FROM rang WHERE id = ?', [rangId]);
  if (!r) throw new Eingabefehler('Mindestrang ist unbekannt.');
  return rangId;
}

async function speichereRollen(db: Db, schichtId: number, rollen: Record<string, unknown> | undefined): Promise<void> {
  if (!rollen) return;
  const bekannt = new Set((await alle<{ name: string }>(db, 'SELECT name FROM rolle')).map((r) => r.name));
  await schreibe(db, 'DELETE FROM schicht_rolle WHERE schicht_id = ?', [schichtId]);
  for (const [rolle, wert] of Object.entries(rollen)) {
    if (!bekannt.has(rolle)) throw new Eingabefehler(`Rolle «${rolle}» ist unbekannt.`);
    const anzahl = ganzzahl(wert, `Anzahl ${rolle}`, 0, 10000);
    if (!anzahl) continue;
    await schreibe(db, 'INSERT INTO schicht_rolle (schicht_id, rolle, anzahl) VALUES (?, ?, ?)', [schichtId, rolle, anzahl]);
  }
}

/**
 * Regel 13.2.2 und Entscheid Yann: Eine neue Schicht übernimmt Ort, Ort Abtreten, Tenue und
 * Hinweis vom Einsatz. Eine neue zusätzliche Schicht ist nicht publiziert.
 */
export async function erstelleSchicht(db: Db, einsatzId: number, e: SchichtEingabe): Promise<number> {
  const name = pflichtText(e.name, 'Name');
  const leer = (w: unknown) => typeof w !== 'string' || !w.trim();
  const offen = leer(e.start_zeit) || leer(e.end_zeit);
  const start = zeitpunkt(e.start_datum, leer(e.start_zeit) ? OFFEN_BEGINN : e.start_zeit, 'Start');
  const ende = zeitpunkt(e.end_datum, leer(e.end_zeit) ? OFFEN_ENDE : e.end_zeit, 'Ende');
  if (ende <= start) throw new Eingabefehler('Das Ende muss nach dem Start liegen.');
  return transaktion(db, async (c) => {
    const einsatz = await ladeEinsatz(c, einsatzId);
    const minRang = await pruefeRang(c, e.min_rang_id);
    const r = await schreibe(
      c,
      `INSERT INTO schicht (einsatz_id, name, start_zeit, end_zeit, ort, abtreten_ort, tenue, aufgebot_hinweis,
         min_alter, min_rang_id, soll_anzahl, bemerkung_intern, bemerkung_extern, publiziert, zeit_offen, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${offen ? 1 : 0},
         (SELECT COALESCE(MAX(x.position), 0) + 1 FROM schicht x WHERE x.einsatz_id = ?))`,
      [
        einsatzId, name, start, ende, einsatz.ort, einsatz.abtreten_ort, einsatz.tenue, einsatz.aufgebot_hinweis,
        ganzzahl(e.min_alter, 'Mindestalter', 0, 120), minRang, ganzzahl(e.soll_anzahl, 'Soll-Anzahl', 0, 100000),
        text(e.bemerkung_intern, 'Bemerkung intern', 5000), text(e.bemerkung_extern, 'Bemerkung extern', 5000), einsatzId,
      ],
    );
    await speichereRollen(c, r.insertId, e.rollen);
    return r.insertId;
  });
}

/** Schicht ändern, inklusive Rollenbedarf. Der Ort gilt nur für diese Schicht (13.3.3). */
export async function aendereSchicht(db: Db, id: number, e: SchichtEingabe): Promise<void> {
  const name = pflichtText(e.name, 'Name');
  // Leere Zeit = offen (00:00 bzw. 23:59), wie beim neuen Einsatz.
  const leer = (w: unknown) => typeof w !== 'string' || !w.trim();
  const offen = leer(e.start_zeit) || leer(e.end_zeit);
  const start = zeitpunkt(e.start_datum, leer(e.start_zeit) ? OFFEN_BEGINN : e.start_zeit, 'Start');
  const ende = zeitpunkt(e.end_datum, leer(e.end_zeit) ? OFFEN_ENDE : e.end_zeit, 'Ende');
  if (ende <= start) throw new Eingabefehler('Das Ende muss nach dem Start liegen.');
  await transaktion(db, async (c) => {
    const alt = await eine<{ version: number }>(c, 'SELECT version FROM schicht WHERE id = ? FOR UPDATE', [id]);
    if (!alt) throw new NichtGefunden('Schicht nicht gefunden.');
    pruefeVersion(
      e.version,
      alt.version,
      'Ein anderer Benutzer hat diese Schicht inzwischen geändert. Das Tool hat nichts gespeichert. Deine Eingaben stehen unten. Prüfe die aktuellen Werte in einem neuen Tab. Speichere dann erneut, wenn deine Werte gelten sollen.',
    );
    const minRang = await pruefeRang(c, e.min_rang_id);
    const r = await schreibe(
      c,
      `UPDATE schicht SET name = ?, start_zeit = ?, end_zeit = ?, ort = ?, abtreten_ort = ?, tenue = ?,
         aufgebot_hinweis = ?, min_alter = ?, min_rang_id = ?, soll_anzahl = ?, bemerkung_intern = ?, bemerkung_extern = ?,
         zeit_offen = ?, version = version + 1
       WHERE id = ?`,
      [
        name, start, ende, text(e.ort, 'Ort Antreten'), text(e.abtreten_ort, 'Ort Abtreten'), text(e.tenue, 'Tenue'),
        text(e.aufgebot_hinweis, 'Hinweis Aufgebot', 2000), ganzzahl(e.min_alter, 'Mindestalter', 0, 120), minRang,
        ganzzahl(e.soll_anzahl, 'Soll-Anzahl', 0, 100000), text(e.bemerkung_intern, 'Bemerkung intern', 5000),
        text(e.bemerkung_extern, 'Bemerkung extern', 5000), offen ? 1 : 0, id,
      ],
    );
    if (r.affectedRows === 0) throw new NichtGefunden('Schicht nicht gefunden.');
    await speichereRollen(c, id, e.rollen);
  });
}

/** Eine Zeile der Tabelle «Schichten bearbeiten» (Einsatz › Schichten). */
export interface SchichtZeile {
  /** Leer = neue Schicht (unterste Zeile). */
  id?: number;
  version?: unknown;
  name: unknown;
  datum: unknown;
  beginn: unknown;
  ende: unknown;
  soll_anzahl?: unknown;
  ort?: unknown;
  bemerkung_intern?: unknown;
  rollen?: Record<string, unknown>;
  /** Fingerabdruck der Werte beim Anzeigen. Gleich = die Person hat die Zeile nicht angefasst. */
  ursprung?: unknown;
}

/** Fingerabdruck der Werte einer Zeile, so wie das Formular sie sendet. */
export function zeilenAbdruck(z: SchichtZeile): string {
  const t = (w: unknown) => (typeof w === 'string' ? w.trim() : w === null || w === undefined ? '' : String(w));
  const rollen = Object.entries(z.rollen ?? {}).map(([r, n]) => [r, t(n) === '0' ? '' : t(n)]).filter(([, n]) => n !== '').sort();
  return JSON.stringify([t(z.name), t(z.datum), t(z.beginn), t(z.ende), t(z.soll_anzahl), t(z.ort), t(z.bemerkung_intern), rollen]);
}

/**
 * Prüft, ob eine Schicht in die Tabelle passt: Das Ende liegt am selben Tag oder am Folgetag (Nachtschicht).
 * Längere Schichten bearbeitet die Aufgebotsstelle im Formular der Schicht.
 */
export function passtInTabelle(s: { start_zeit: string; end_zeit: string }): boolean {
  const tag = lokalesDatum(s.start_zeit);
  const endTag = lokalesDatum(s.end_zeit);
  return endTag === tag || (endTag === plusTage(tag, 1) && lokaleZeit(s.end_zeit) <= lokaleZeit(s.start_zeit));
}

/** Start und Ende aus Datum, Beginn und Ende. Ende ≤ Beginn = Ende am Folgetag. */
function zeitenAusZeile(z: SchichtZeile, feld: string): { start: string; ende: string; offen: boolean } {
  const beginnRoh = typeof z.beginn === 'string' ? z.beginn.trim() : '';
  const endeRoh = typeof z.ende === 'string' ? z.ende.trim() : '';
  // Leere Zeit = offen (Wunsch Yann): Beginn 00:00, Ende 23:59, später nachtragen.
  const beginnZeit = beginnRoh || OFFEN_BEGINN;
  const endeZeit = endeRoh || OFFEN_ENDE;
  const datum = typeof z.datum === 'string' ? z.datum.trim() : '';
  const start = zeitpunkt(datum, beginnZeit, `${feld}: Beginn`);
  const endDatum = endeRoh && beginnRoh && endeRoh <= beginnRoh ? plusTage(datum, 1) : datum;
  const ende = zeitpunkt(endDatum, endeZeit, `${feld}: Ende`);
  if (ende <= start) throw new Eingabefehler(`${feld}: Das Ende muss nach dem Beginn liegen.`);
  return { start, ende, offen: !beginnRoh || !endeRoh };
}

/** Gespeicherte Zeiten für «Zeit offen». */
export const OFFEN_BEGINN = '00:00';
export const OFFEN_ENDE = '23:59';

/** Beginn und Ende für die Anzeige: leer, wenn die Zeit offen ist und der Wert der Platzhalter ist. */
export function anzeigeZeiten(s: { start_zeit: string; end_zeit: string; zeit_offen: number }): { beginn: string; ende: string } {
  const beginn = lokaleZeit(s.start_zeit);
  const ende = lokaleZeit(s.end_zeit);
  if (!Number(s.zeit_offen)) return { beginn, ende };
  return { beginn: beginn === OFFEN_BEGINN ? '' : beginn, ende: ende === OFFEN_ENDE ? '' : ende };
}

/**
 * Tabelle «Schichten bearbeiten»: mehrere Schichten auf einmal ändern und eine neue anlegen.
 * Alles in einer Transaktion. Unveränderte Zeilen schreibt das Tool nicht (keine neue Version).
 * Eine geänderte Zeile mit alter Version speichert nichts (Konflikt).
 * Felder ausserhalb der Tabelle (Tenue, Abtreten, Mindestalter, Bemerkung extern …) bleiben gleich.
 */
export async function speichereSchichtTabelle(
  db: Db, einsatzId: number, zeilen: SchichtZeile[], neu: SchichtZeile | null,
): Promise<{ geaendert: number; neuId: number | null }> {
  return transaktion(db, async (c) => {
    await ladeEinsatz(c, einsatzId);
    const vorhanden = await alle<Schicht>(c, 'SELECT * FROM schicht WHERE einsatz_id = ? FOR UPDATE', [einsatzId]);
    const bedarf = await alle<{ schicht_id: number; rolle: string; anzahl: number }>(
      c, 'SELECT r.schicht_id, r.rolle, r.anzahl FROM schicht_rolle r JOIN schicht s ON s.id = r.schicht_id WHERE s.einsatz_id = ?', [einsatzId],
    );
    let geaendert = 0;
    for (const z of zeilen) {
      const alt = vorhanden.find((s) => s.id === z.id);
      if (!alt) throw new NichtGefunden('Schicht nicht gefunden.');
      if (!passtInTabelle(alt)) continue;
      // Nicht angefasst: nichts schreiben, auch wenn ein anderer Benutzer die Schicht inzwischen geändert hat.
      if (typeof z.ursprung === 'string' && z.ursprung === zeilenAbdruck(z)) continue;
      const name = pflichtText(z.name, 'Name');
      const { start, ende, offen } = zeitenAusZeile(z, name);
      const soll = ganzzahl(z.soll_anzahl, `${name}: Soll`, 0, 100000);
      const ort = text(z.ort, `${name}: Antretensort`);
      const bemerkung = text(z.bemerkung_intern, `${name}: Interne Bemerkung`, 5000);
      const altRollen = new Map(bedarf.filter((b) => b.schicht_id === alt.id).map((b) => [b.rolle, Number(b.anzahl)]));
      const neueRollen = new Map<string, number>();
      for (const [rolle, wert] of Object.entries(z.rollen ?? {})) {
        const n = ganzzahl(wert, `${name}: ${rolle}`, 0, 10000);
        if (n) neueRollen.set(rolle, n);
      }
      const rollenGleich = altRollen.size === neueRollen.size && [...neueRollen].every(([r, n]) => altRollen.get(r) === n);
      const gleich = alt.name === name && alt.start_zeit === start && alt.end_zeit === ende && Number(alt.zeit_offen) === (offen ? 1 : 0) && alt.soll_anzahl === soll
        && alt.ort === ort && alt.bemerkung_intern === bemerkung && rollenGleich;
      if (gleich) continue;
      pruefeVersion(
        z.version,
        alt.version,
        `Ein anderer Benutzer hat die Schicht «${alt.name}» inzwischen geändert. Das Tool hat nichts gespeichert. Deine Eingaben stehen unten. Speichere erneut, wenn deine Werte gelten sollen.`,
      );
      await schreibe(
        c,
        `UPDATE schicht SET name = ?, start_zeit = ?, end_zeit = ?, zeit_offen = ?, soll_anzahl = ?, ort = ?, bemerkung_intern = ?, version = version + 1 WHERE id = ?`,
        [name, start, ende, offen ? 1 : 0, soll, ort, bemerkung, alt.id],
      );
      if (!rollenGleich) await speichereRollen(c, alt.id, z.rollen ?? {});
      geaendert++;
    }
    let neuId: number | null = null;
    const neuName = typeof neu?.name === 'string' ? neu.name.trim() : '';
    if (neu && neuName) {
      const { start, ende, offen } = zeitenAusZeile(neu, neuName);
      const sDatum = lokalesDatum(start);
      const eDatum = lokalesDatum(ende);
      neuId = await erstelleSchicht(c, einsatzId, {
        name: neuName, start_datum: sDatum, start_zeit: lokaleZeit(start), end_datum: eDatum, end_zeit: lokaleZeit(ende),
        soll_anzahl: neu.soll_anzahl, bemerkung_intern: neu.bemerkung_intern, rollen: neu.rollen,
      });
      // Eine neue Schicht übernimmt den Ort vom Einsatz. Ein Ort in der Zeile gilt nur für diese Schicht.
      const ort = text(neu.ort, `${neuName}: Antretensort`);
      if (ort) await schreibe(c, 'UPDATE schicht SET ort = ? WHERE id = ?', [ort, neuId]);
      if (offen) await schreibe(c, 'UPDATE schicht SET zeit_offen = 1 WHERE id = ?', [neuId]);
    }
    return { geaendert, neuId };
  });
}

export async function setzePubliziert(db: Db, id: number, publiziert: boolean): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'UPDATE schicht SET publiziert = ? WHERE id = ?', [publiziert ? 1 : 0, id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Schicht nicht gefunden.');
  });
}

export async function anzahlAnmeldungenSchicht(db: Db, id: number): Promise<number> {
  const z = await eine<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM anmeldung WHERE schicht_id = ?', [id]);
  return Number(z?.n ?? 0);
}

/**
 * Regel 13.2.4: Löschen verlangt eine Bestätigung (die Route zeigt die Zahl der Anmeldungen).
 * Ein Einsatz behält mindestens eine Schicht.
 */
export async function loescheSchicht(db: Db, id: number): Promise<number> {
  return transaktion(db, async (c) => {
    const s = await ladeSchicht(c, id);
    if (s.anzahl_schichten <= 1) {
      throw new Eingabefehler('Ein Einsatz hat mindestens eine Schicht. Lösche stattdessen den Einsatz.');
    }
    await schreibe(c, 'DELETE FROM schicht WHERE id = ?', [id]);
    return s.einsatz_id;
  });
}

/** Regel 13.4: sichtbar im Formular, wenn publiziert und Ende in der Zukunft. */
export function istSichtbar(s: { publiziert: number; end_zeit: string }, jetzt = jetztIso()): boolean {
  return Number(s.publiziert) === 1 && s.end_zeit > jetzt;
}

export interface Fremdabteilung {
  id: number;
  schicht_id: number;
  name: string;
  anzahl: number;
  bemerkung: string | null;
}

export async function fremdabteilungen(db: Db, schichtId: number): Promise<Fremdabteilung[]> {
  return alle<Fremdabteilung>(db, 'SELECT * FROM fremdabteilung WHERE schicht_id = ? ORDER BY id', [schichtId]);
}

/** Fremdabteilung anlegen (id leer), ändern oder löschen (loeschen = true, Route verlangt Bestätigung). */
export async function speichereFremdabteilung(
  db: Db,
  schichtId: number,
  e: { id?: unknown; name?: unknown; anzahl?: unknown; bemerkung?: unknown; loeschen?: boolean },
): Promise<void> {
  await transaktion(db, async (c) => {
    await ladeSchicht(c, schichtId);
    const fid = ganzzahl(e.id, 'ID', 1, 2_147_483_647);
    if (fid && e.loeschen) {
      await schreibe(c, 'DELETE FROM fremdabteilung WHERE id = ? AND schicht_id = ?', [fid, schichtId]);
      return;
    }
    const name = pflichtText(e.name, 'Name');
    const anzahl = ganzzahl(e.anzahl, 'Anzahl', 1, 100000);
    if (!anzahl) throw new Eingabefehler('Anzahl fehlt.');
    const bemerkung = text(e.bemerkung, 'Bemerkung', 2000);
    if (fid) {
      await schreibe(c, 'UPDATE fremdabteilung SET name = ?, anzahl = ?, bemerkung = ? WHERE id = ? AND schicht_id = ?', [
        name, anzahl, bemerkung, fid, schichtId,
      ]);
    } else {
      await schreibe(c, 'INSERT INTO fremdabteilung (schicht_id, name, anzahl, bemerkung) VALUES (?, ?, ?, ?)', [
        schichtId, name, anzahl, bemerkung,
      ]);
    }
  });
}

/** Rollenbedarf einer Schicht. */
export async function rollenBedarf(db: Db, schichtId: number): Promise<Map<string, number>> {
  const z = await alle<{ rolle: string; anzahl: number }>(db, 'SELECT rolle, anzahl FROM schicht_rolle WHERE schicht_id = ?', [schichtId]);
  return new Map(z.map((r) => [r.rolle, Number(r.anzahl)]));
}
