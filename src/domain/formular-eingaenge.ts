// Seite «Formular»: jedes Ausfüllen des Anmeldeformulars einzeln (Wunsch Yann 20.11.2026).
// Anzeige und Filter. Die Einträge ändern sich über die bestehenden Routen (Fenster, Bestätigen, Zuordnen).
// Löschen eines ganzen Eingangs (Wunsch Yann 26.11.2026): loescheEingang().
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { NichtGefunden, type Status } from './eingabe.js';

export const EINGANG_FILTER = ['alle', 'neu', 'unbekannt', 'bemerkung'] as const;
export type EingangFilter = (typeof EINGANG_FILTER)[number];
export const EINGANG_FILTER_TEXT: Record<EingangFilter, string> = {
  alle: 'Alle', neu: 'Noch nicht bestätigt', unbekannt: 'Unbekannt oder mehrdeutig', bemerkung: 'Mit Bemerkung',
};

export interface EingangSchicht {
  schicht_id: number;
  schicht_name: string;
  start_zeit: string;
  end_zeit: string;
  zeit_offen: number;
  einsatz_id: number;
  einsatz_name: string;
  /** Leer = der Eintrag ist inzwischen entfernt. */
  anmeldung_id: number | null;
  status: Status | null;
  version: number | null;
  anmeldung_person_id: number | null;
  /** 0 = die Person hatte schon einen Eintrag. Das Formular hat nur die Bemerkung ergänzt. */
  neu: number;
  bemerkung: string | null;
}

export interface Eingang {
  id: number;
  zeit: string;
  name: string | null;
  person_id: number | null;
  treffer: string | null;
  nachgetragen: number;
  person_vorname: string | null;
  person_nachname: string | null;
  rang_name: string | null;
  /** Person, der ein unbekannter Eintrag später zugeordnet wurde. */
  zugeordnet_id: number | null;
  schichten: EingangSchicht[];
}

/** Die neuesten Eingänge, neueste zuerst. */
export async function formularEingaenge(db: Db, grenze = 300): Promise<Eingang[]> {
  const eingaenge = await alle<Omit<Eingang, 'schichten' | 'zugeordnet_id'>>(
    db,
    `SELECT f.id, f.zeit, f.name, f.person_id, f.treffer, f.nachgetragen,
            p.vorname AS person_vorname, p.nachname AS person_nachname, r.name AS rang_name
       FROM formular_eingang f LEFT JOIN person p ON p.clubdesk_id = f.person_id LEFT JOIN rang r ON r.id = p.rang_id
      ORDER BY f.zeit DESC, f.id DESC LIMIT ?`,
    [grenze],
  );
  if (!eingaenge.length) return [];
  const zeilen = await alle<EingangSchicht & { eingang_id: number }>(
    db,
    `SELECT fs.eingang_id, fs.schicht_id, s.name AS schicht_name, s.start_zeit, s.end_zeit, s.zeit_offen,
            e.id AS einsatz_id, e.name AS einsatz_name, a.id AS anmeldung_id, a.status, a.version,
            a.person_id AS anmeldung_person_id, fs.neu, fs.bemerkung
       FROM formular_eingang_schicht fs
       JOIN schicht s ON s.id = fs.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
       LEFT JOIN anmeldung a ON a.id = fs.anmeldung_id
      WHERE fs.eingang_id IN (?)
      ORDER BY s.start_zeit, s.id`,
    [eingaenge.map((x) => x.id)],
  );
  const proEingang = new Map<number, EingangSchicht[]>();
  for (const z of zeilen) {
    if (!proEingang.has(z.eingang_id)) proEingang.set(z.eingang_id, []);
    proEingang.get(z.eingang_id)!.push(z);
  }
  return eingaenge.map((x) => {
    const schichten = proEingang.get(x.id) ?? [];
    const zugeordnet = x.person_id === null ? schichten.find((s) => s.anmeldung_person_id !== null)?.anmeldung_person_id ?? null : null;
    return { ...x, zugeordnet_id: zugeordnet, schichten };
  });
}

/** Ist der Eingang noch keiner Person sicher zugeordnet? */
export function istUnbekannt(e: Eingang): boolean {
  return e.person_id === null && e.schichten.some((s) => s.anmeldung_id !== null && s.anmeldung_person_id === null);
}

export function passtZuFilter(e: Eingang, f: EingangFilter): boolean {
  switch (f) {
    case 'alle': return true;
    case 'neu': return e.schichten.some((s) => s.status === 'angemeldet');
    case 'unbekannt': return istUnbekannt(e) || !!e.treffer;
    case 'bemerkung': return e.schichten.some((s) => !!s.bemerkung);
  }
}

export interface EingangLoeschenVorschau {
  id: number;
  zeit: string;
  name: string | null;
  /** Einträge, die dieser Eingang angelegt hat. Das Tool löscht sie mit ihrem Statusprotokoll. */
  loeschen: { anmeldung_id: number; status: Status; einsatz_name: string; schicht_name: string; start_zeit: string; end_zeit: string; zeit_offen: number }[];
  /** Einträge, die schon vor dem Eingang bestanden. Sie bleiben. */
  bleiben: number;
}

const EINTRAEGE_SQL = `SELECT fs.anmeldung_id, fs.neu, a.status, e.name AS einsatz_name, s.name AS schicht_name, s.start_zeit, s.end_zeit, s.zeit_offen
   FROM formular_eingang_schicht fs
   JOIN anmeldung a ON a.id = fs.anmeldung_id
   JOIN schicht s ON s.id = fs.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
  WHERE fs.eingang_id = ?
  ORDER BY s.start_zeit, s.id`;

type EintragZeile = EingangLoeschenVorschau['loeschen'][number] & { neu: number };

async function vorschau(c: Db, id: number, sperren: boolean): Promise<EingangLoeschenVorschau> {
  const e = await eine<{ id: number; zeit: string; name: string | null }>(
    c, `SELECT id, zeit, name FROM formular_eingang WHERE id = ?${sperren ? ' FOR UPDATE' : ''}`, [id],
  );
  if (!e) throw new NichtGefunden('Eingang nicht gefunden. Ein anderer Benutzer hat ihn vielleicht schon gelöscht.');
  const zeilen = await alle<EintragZeile>(c, EINTRAEGE_SQL + (sperren ? ' FOR UPDATE' : ''), [id]);
  return {
    ...e,
    loeschen: zeilen.filter((z) => z.neu).map(({ neu: _neu, ...z }) => z),
    bleiben: zeilen.filter((z) => !z.neu).length,
  };
}

/** Was «Eingang löschen» entfernt. Für die Rückfrage. */
export async function eingangLoeschenVorschau(db: Db, id: number): Promise<EingangLoeschenVorschau> {
  return vorschau(db, id, false);
}

/**
 * Eingang vollständig löschen (Wunsch Yann 26.11.2026). Die Route verlangt vorher eine Bestätigung.
 * Das Tool löscht den Eingang, seine Momentaufnahme und die Einträge, die er angelegt hat (mit Statusprotokoll).
 * Einträge, die schon vorher bestanden («war schon eingetragen»), bleiben.
 * Kein Rückgängig: Der Eingang ist danach weg.
 */
export async function loescheEingang(db: Db, id: number): Promise<EingangLoeschenVorschau> {
  return transaktion(db, async (c) => {
    const v = await vorschau(c, id, true);
    const ids = v.loeschen.map((x) => x.anmeldung_id);
    if (ids.length) await schreibe(c, 'DELETE FROM anmeldung WHERE id IN (?)', [ids]);
    await schreibe(c, 'DELETE FROM formular_eingang WHERE id = ?', [id]);
    return v;
  });
}
