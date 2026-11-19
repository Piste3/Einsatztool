// Anmeldungen: Status, Rolle, Kanal, Bemerkung, Statusprotokoll (13.5, 5.6, 14.6).
// Jede Änderung schreibt in derselben Transaktion einen Eintrag in status_log.
import type { PoolConnection } from 'mysql2/promise';
import { alle, eine, schreibe, transaktion, Wiederholen, type Db } from '../db/db.js';
import { Eingabefehler, NichtGefunden, STATUS, KANAELE, auswahl, pruefeVersion, text, type Kanal, type Status } from './eingabe.js';
import { jetztIso, lokalesDatum, lokaleZeit } from './zeit.js';

export interface Anmeldung {
  id: number;
  schicht_id: number;
  person_id: number | null;
  name_text: string;
  email_text: string | null;
  status: Status;
  rolle: string | null;
  kanal: Kanal;
  bemerkung: string | null;
  erstellt_am: string;
  geaendert_am: string;
  mail_gesendet_am: string | null;
  /** Zählt jede Änderung. Schutz gegen gegenseitiges Überschreiben. */
  version: number;
}

export async function schreibeLog(
  c: Db,
  anmeldungId: number,
  benutzerId: number | null,
  aktion: string,
  alt: string | null,
  neu: string | null,
  zeit = jetztIso(),
): Promise<void> {
  await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
    anmeldungId, zeit, benutzerId, aktion, alt, neu,
  ]);
}

export async function ladeAnmeldung(db: Db, id: number): Promise<Anmeldung> {
  const a = await eine<Anmeldung>(db, 'SELECT * FROM anmeldung WHERE id = ?', [id]);
  if (!a) throw new NichtGefunden('Eintrag nicht gefunden.');
  return a;
}

async function pruefeRolle(c: Db, rolle: string | null): Promise<string | null> {
  if (!rolle) return null;
  const r = await eine(c, 'SELECT name FROM rolle WHERE name = ?', [rolle]);
  if (!r) throw new Eingabefehler('Rolle ist unbekannt.');
  return rolle;
}

/** Anzeigename einer Person. */
export function personenName(p: { vorname: string | null; nachname: string | null }): string {
  return [p.vorname, p.nachname].filter(Boolean).join(' ').trim();
}

export interface Aenderung {
  status?: unknown;
  rolle?: unknown;
  kanal?: unknown;
  bemerkung?: unknown;
  /** Version, die das Formular angezeigt hat. Leer = keine Prüfung. */
  version?: unknown;
}

/**
 * Ändert Felder eines Eintrags und schreibt je geändertem Feld einen Log-Eintrag (13.5.3).
 * Jeder Wechsel zwischen allen Status ist erlaubt (13.5.1).
 * Wechsel nach «bestaetigt» setzt mail_gesendet_am auf leer (18.2.3).
 */
async function aendereFelder(c: PoolConnection, alt: Anmeldung, a: Aenderung, benutzerId: number | null): Promise<boolean> {
  const neu: Partial<Anmeldung> = {};
  if (a.status !== undefined) neu.status = auswahl(a.status, STATUS, 'Status');
  if (a.rolle !== undefined) neu.rolle = await pruefeRolle(c, text(a.rolle, 'Rolle', 100));
  if (a.kanal !== undefined) neu.kanal = auswahl(a.kanal, KANAELE, 'Kanal');
  if (a.bemerkung !== undefined) neu.bemerkung = text(a.bemerkung, 'Bemerkung', 5000);

  const zeit = jetztIso();
  let geaendert = false;
  for (const feld of ['status', 'rolle', 'kanal', 'bemerkung'] as const) {
    if (!(feld in neu)) continue;
    const vorher = (alt[feld] ?? null) as string | null;
    const nachher = (neu[feld] ?? null) as string | null;
    if (vorher === nachher) continue;
    geaendert = true;
    await schreibeLog(c, alt.id, benutzerId, feld, vorher, nachher, zeit);
  }
  if (!geaendert) return false;
  const status = neu.status ?? alt.status;
  const wirdBestaetigt = neu.status === 'bestaetigt' && alt.status !== 'bestaetigt';
  await schreibe(
    c,
    `UPDATE anmeldung SET status = ?, rolle = ?, kanal = ?, bemerkung = ?, geaendert_am = ?, version = version + 1,
       mail_gesendet_am = ${wirdBestaetigt ? 'NULL' : 'mail_gesendet_am'} WHERE id = ?`,
    [
      status,
      'rolle' in neu ? neu.rolle : alt.rolle,
      neu.kanal ?? alt.kanal,
      'bemerkung' in neu ? neu.bemerkung : alt.bemerkung,
      zeit,
      alt.id,
    ],
  );
  return true;
}

/** Ändert Status, Rolle, Kanal oder Bemerkung eines Eintrags. */
export async function aendereAnmeldung(db: Db, id: number, a: Aenderung, benutzerId: number | null): Promise<Anmeldung> {
  return transaktion(db, async (c) => {
    const alt = await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE id = ? FOR UPDATE', [id]);
    if (!alt) throw new NichtGefunden('Eintrag nicht gefunden. Ein anderer Benutzer hat ihn vielleicht entfernt.');
    pruefeVersion(a.version, alt.version, await konfliktText(c, alt));
    await aendereFelder(c, alt, a, benutzerId);
    return (await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE id = ?', [id]))!;
  });
}

/** Meldung bei einem Konflikt: wer den Eintrag zuletzt geändert hat und wann. */
async function konfliktText(c: Db, a: Anmeldung): Promise<string> {
  const letzte = await eine<{ zeit: string; benutzer: string | null }>(
    c,
    `SELECT l.zeit, b.name AS benutzer FROM status_log l LEFT JOIN benutzer b ON b.id = l.benutzer_id
      WHERE l.anmeldung_id = ? ORDER BY l.zeit DESC, l.id DESC LIMIT 1`,
    [a.id],
  );
  const wer = letzte ? `${letzte.benutzer ?? 'Das Formular'} hat ihn am ${lokalesDatum(letzte.zeit).split('-').reverse().join('.')} um ${lokaleZeit(letzte.zeit)} geändert. ` : '';
  return `Der Eintrag von ${a.name_text} hat sich inzwischen geändert. ${wer}Das Tool hat deine Änderung nicht gespeichert. Prüfe die neuen Werte und speichere erneut.`;
}

/** Fügt einen Eintrag ein. Legt ein anderer Benutzer gleichzeitig denselben Eintrag an, startet die Transaktion neu. */
export async function fuegeEin(c: Db, sql: string, werte: unknown[]) {
  try {
    return await schreibe(c, sql, werte);
  } catch (fehler) {
    if ((fehler as { code?: string }).code === 'ER_DUP_ENTRY') throw new Wiederholen('Eintrag gleichzeitig angelegt.');
    throw fehler;
  }
}

export interface NeueAnmeldung {
  schichtId: number;
  personId: number;
  status: unknown;
  kanal: unknown;
  rolle?: unknown;
  bemerkung?: unknown;
}

/**
 * Person von Hand eintragen. Regel 13.5.4: Gibt es schon einen Eintrag, ändert das Tool ihn.
 */
export async function setzeAnmeldung(db: Db, n: NeueAnmeldung, benutzerId: number | null): Promise<number> {
  const status = auswahl(n.status, STATUS, 'Status');
  const kanal = auswahl(n.kanal, KANAELE, 'Kanal');
  return transaktion(db, async (c) => {
    const schicht = await eine(c, 'SELECT id FROM schicht WHERE id = ?', [n.schichtId]);
    if (!schicht) throw new NichtGefunden('Schicht nicht gefunden.');
    const person = await eine<{ vorname: string | null; nachname: string | null; geloescht_am: string | null }>(
      c,
      'SELECT vorname, nachname, geloescht_am FROM person WHERE clubdesk_id = ?',
      [n.personId],
    );
    if (!person) throw new Eingabefehler('Person nicht gefunden.');
    if (person.geloescht_am) throw new Eingabefehler('Die Personendaten sind gelöscht.');
    const vorhanden = await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE schicht_id = ? AND person_id = ? FOR UPDATE', [
      n.schichtId, n.personId,
    ]);
    if (vorhanden) {
      const aenderung: Aenderung = { status, kanal };
      if (n.rolle !== undefined) aenderung.rolle = n.rolle;
      if (n.bemerkung !== undefined) aenderung.bemerkung = n.bemerkung;
      await aendereFelder(c, vorhanden, aenderung, benutzerId);
      return vorhanden.id;
    }
    const rolle = await pruefeRolle(c, text(n.rolle, 'Rolle', 100));
    const bemerkung = text(n.bemerkung, 'Bemerkung', 5000);
    const zeit = jetztIso();
    const r = await fuegeEin(
      c,
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, status, rolle, kanal, bemerkung, erstellt_am, geaendert_am)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.schichtId, n.personId, personenName(person), status, rolle, kanal, bemerkung, zeit, zeit],
    );
    await schreibeLog(c, r.insertId, benutzerId, 'erstellt', null, status, zeit);
    if (rolle) await schreibeLog(c, r.insertId, benutzerId, 'rolle', null, rolle, zeit);
    if (bemerkung) await schreibeLog(c, r.insertId, benutzerId, 'bemerkung', null, bemerkung, zeit);
    return r.insertId;
  });
}

/** Status für mehrere Personen einer Schicht setzen (14.3, Sammelstatus). */
export async function sammelstatus(
  db: Db,
  schichtId: number,
  personIds: number[],
  status: unknown,
  kanal: unknown,
  benutzerId: number | null,
): Promise<number> {
  if (!personIds.length) throw new Eingabefehler('Keine Person gewählt.');
  return transaktion(db, async (c) => {
    for (const personId of personIds) await setzeAnmeldung(c, { schichtId, personId, status, kanal }, benutzerId);
    return personIds.length;
  });
}

/**
 * Alle Einträge mit «angemeldet» in den Schichten bestätigen. Ändert nur den Status.
 */
export async function bestaetigeAlle(db: Db, schichtIds: number[], benutzerId: number | null): Promise<number> {
  if (!schichtIds.length) return 0;
  return transaktion(db, async (c) => {
    const offen = await alle<Anmeldung>(
      c,
      "SELECT * FROM anmeldung WHERE schicht_id IN (?) AND status = 'angemeldet' FOR UPDATE",
      [schichtIds],
    );
    for (const a of offen) await aendereFelder(c, a, { status: 'bestaetigt' }, benutzerId);
    return offen.length;
  });
}

/** Eintrag entfernen. Die Route verlangt vorher eine Bestätigung. */
export async function loescheAnmeldung(db: Db, id: number): Promise<number> {
  return transaktion(db, async (c) => {
    const a = await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE id = ?', [id]);
    if (!a) throw new NichtGefunden('Eintrag nicht gefunden. Ein anderer Benutzer hat ihn vielleicht schon entfernt.');
    await schreibe(c, 'DELETE FROM anmeldung WHERE id = ?', [id]);
    return a.schicht_id;
  });
}

export type ZuordnenErgebnis = { ok: true } | { ok: false; bestehendeId: number };

/**
 * Regel 14.6.4: Unbekannten Eintrag einer Person zuordnen.
 * Regel 14.6.5: Hat die Person schon einen Eintrag in der Schicht, führt das Tool nichts zusammen.
 */
export async function ordneZu(db: Db, anmeldungId: number, personId: number, benutzerId: number | null): Promise<ZuordnenErgebnis> {
  return transaktion(db, async (c) => {
    const a = await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE id = ? FOR UPDATE', [anmeldungId]);
    if (!a) throw new NichtGefunden('Eintrag nicht gefunden.');
    if (a.person_id !== null) throw new Eingabefehler('Der Eintrag ist schon zugeordnet.');
    const p = await eine<{ vorname: string | null; nachname: string | null; geloescht_am: string | null }>(
      c,
      'SELECT vorname, nachname, geloescht_am FROM person WHERE clubdesk_id = ?',
      [personId],
    );
    if (!p || p.geloescht_am) throw new Eingabefehler('Person nicht gefunden.');
    const doppelt = await eine<{ id: number }>(c, 'SELECT id FROM anmeldung WHERE schicht_id = ? AND person_id = ?', [
      a.schicht_id, personId,
    ]);
    if (doppelt) return { ok: false, bestehendeId: doppelt.id };
    const name = personenName(p);
    const zeit = jetztIso();
    await schreibe(c, 'UPDATE anmeldung SET person_id = ?, name_text = ?, email_text = NULL, geaendert_am = ?, version = version + 1 WHERE id = ?', [
      personId, name, zeit, anmeldungId,
    ]);
    const vorher = a.email_text ? `${a.name_text} <${a.email_text}>` : a.name_text;
    await schreibeLog(c, anmeldungId, benutzerId, 'zugeordnet', vorher, `${name} (${personId})`, zeit);
    return { ok: true };
  });
}

export interface LogEintrag {
  zeit: string;
  aktion: string;
  alt_wert: string | null;
  neu_wert: string | null;
  benutzer: string | null;
}

/** Statusprotokoll eines Eintrags, neueste zuerst. */
export async function verlauf(db: Db, anmeldungIds: number[]): Promise<Map<number, LogEintrag[]>> {
  const m = new Map<number, LogEintrag[]>();
  if (!anmeldungIds.length) return m;
  const z = await alle<LogEintrag & { anmeldung_id: number }>(
    db,
    `SELECT l.anmeldung_id, l.zeit, l.aktion, l.alt_wert, l.neu_wert, b.name AS benutzer
       FROM status_log l LEFT JOIN benutzer b ON b.id = l.benutzer_id
      WHERE l.anmeldung_id IN (?) ORDER BY l.zeit DESC, l.id DESC`,
    [anmeldungIds],
  );
  for (const e of z) {
    if (!m.has(e.anmeldung_id)) m.set(e.anmeldung_id, []);
    m.get(e.anmeldung_id)!.push(e);
  }
  return m;
}

/** Der Eintrag einer Person in einer Schicht, falls es ihn gibt (eine Person hat pro Schicht höchstens einen). */
export async function anmeldungVonPerson(db: Db, schichtId: number, personId: number): Promise<Anmeldung | null> {
  return (await eine<Anmeldung>(db, 'SELECT * FROM anmeldung WHERE schicht_id = ? AND person_id = ?', [schichtId, personId])) ?? null;
}
