// Einsatz › Besetzen (Konzept «Bedienung im Einsatz», OK Yann 20.11.2026).
// Eine Liste für die häufigste Arbeit: Neue bestätigen, Offene nachfassen, Nicht gefragte anfragen.
// Ersetzt die Matrix «Anmeldungen», die Einträge der Schichtseite und die Anrufliste. Nur Anzeige und Filter.
import { alle, type Db } from '../db/db.js';
import type { Status } from './eingabe.js';
import type { Schicht } from './schicht.js';
import { passtZuSchicht, warnungenFuerSchichten, type SchichtWarnungen } from './warnungen.js';
import { nachRangTiefZuerst } from './listen.js';

export const BESETZEN_FILTER = ['an', 'neu', 'offen', 'nicht', 'bestaetigt', 'ab', 'warnung', 'alle'] as const;
export type BesetzenFilter = (typeof BESETZEN_FILTER)[number];

export const BESETZEN_FILTER_TEXT: Record<BesetzenFilter, string> = {
  an: 'Neu + Bestätigt', neu: 'Neu', offen: 'Offen', nicht: 'Nicht gefragt', bestaetigt: 'Bestätigt', ab: 'Ab', warnung: 'Mit Warnung', alle: 'Alle',
};

export interface BesetzenEintrag {
  id: number;
  schicht_id: number;
  person_id: number | null;
  status: Status;
  kanal: string;
  rolle: string | null;
  bemerkung: string | null;
  version: number;
  name_text: string | null;
  email_text: string | null;
}

export interface BesetzenZeile {
  /** p<Clubdesk-ID> für bekannte Personen, u<Anmeldung-ID> für unbekannte Einträge. */
  schluessel: string;
  personId: number | null;
  name: string;
  vorname: string | null;
  nachname: string | null;
  rang_name: string | null;
  rang_reihenfolge: number | null;
  geburtsdatum: string | null;
  telefon: string | null;
  telefon_privat: string | null;
  essenseinschraenkung: string | null;
  email_text: string | null;
  /** Eintrag je Schicht. */
  zellen: Map<number, BesetzenEintrag>;
  /** Passt zu Mindestalter und Mindestrang je Schicht. Unbekannte Einträge passen immer. */
  passt: Map<number, boolean>;
  /** Zahl der Warnungen je Schicht. */
  warnungen: Map<number, number>;
}

export interface BesetzenSchicht extends Schicht {
  min_rang_name: string | null;
  min_rang_reihenfolge: number | null;
}

export interface BesetzenDaten {
  schichten: BesetzenSchicht[];
  zeilen: BesetzenZeile[];
  warnungen: Map<number, SchichtWarnungen>;
}

const OFFEN: Status[] = ['unsicher', 'nachricht_gesendet'];

/** Alle aktiven Personen und alle Einträge des Einsatzes, je eine Zeile. Gelöschte Personen nur mit Eintrag. */
export async function besetzenDaten(db: Db, einsatzId: number): Promise<BesetzenDaten> {
  const schichten = await alle<BesetzenSchicht>(
    db,
    `SELECT s.*, r.name AS min_rang_name, r.reihenfolge AS min_rang_reihenfolge
       FROM schicht s LEFT JOIN rang r ON r.id = s.min_rang_id
      WHERE s.einsatz_id = ? ORDER BY s.start_zeit, s.position, s.id`,
    [einsatzId],
  );
  const ids = schichten.map((s) => s.id);
  const warnungen = await warnungenFuerSchichten(db, ids);
  const eintraege = ids.length
    ? await alle<BesetzenEintrag>(db, 'SELECT id, schicht_id, person_id, status, kanal, rolle, bemerkung, version, name_text, email_text FROM anmeldung WHERE schicht_id IN (?)', [ids])
    : [];
  const mitEintrag = [...new Set(eintraege.map((a) => a.person_id).filter((x): x is number => x !== null))];
  const personen = await alle<any>(
    db,
    `SELECT p.clubdesk_id, p.vorname, p.nachname, p.geburtsdatum, p.telefon, p.telefon_privat, p.essenseinschraenkung,
            r.name AS rang_name, r.reihenfolge AS rang_reihenfolge
       FROM person p LEFT JOIN rang r ON r.id = p.rang_id
      WHERE p.geloescht_am IS NULL${mitEintrag.length ? ' OR p.clubdesk_id IN (?)' : ''}`,
    mitEintrag.length ? [mitEintrag] : [],
  );
  const zeilen = new Map<string, BesetzenZeile>();
  for (const p of personen) {
    zeilen.set(`p${p.clubdesk_id}`, {
      schluessel: `p${p.clubdesk_id}`, personId: Number(p.clubdesk_id),
      name: `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim(), vorname: p.vorname, nachname: p.nachname,
      rang_name: p.rang_name, rang_reihenfolge: p.rang_reihenfolge === null ? null : Number(p.rang_reihenfolge),
      geburtsdatum: p.geburtsdatum, telefon: p.telefon, telefon_privat: p.telefon_privat, essenseinschraenkung: p.essenseinschraenkung,
      email_text: null,
      zellen: new Map(), passt: new Map(schichten.map((s) => [s.id, passtZuSchicht(p, s)])), warnungen: new Map(),
    });
  }
  for (const a of eintraege) {
    const schluessel = a.person_id !== null ? `p${a.person_id}` : `u${a.id}`;
    let z = zeilen.get(schluessel);
    if (!z) {
      // Unbekannte Person aus dem Formular (oder Person ohne Stammdaten): Name aus dem Eintrag.
      z = {
        schluessel, personId: a.person_id, name: a.name_text ?? '', vorname: a.name_text, nachname: null,
        rang_name: null, rang_reihenfolge: null, geburtsdatum: null, telefon: null, telefon_privat: null, essenseinschraenkung: null,
        email_text: a.email_text, zellen: new Map(), passt: new Map(schichten.map((s) => [s.id, true])), warnungen: new Map(),
      };
      zeilen.set(schluessel, z);
    }
    z.zellen.set(a.schicht_id, a);
    const n = warnungen.get(a.schicht_id)?.anmeldungen.get(a.id)?.length ?? 0;
    if (n) z.warnungen.set(a.schicht_id, n);
  }
  return { schichten, zeilen: [...zeilen.values()].sort(nachRangTiefZuerst), warnungen };
}

/** Passt die Zeile in einer Schicht zum Filter? */
function passtInSchicht(z: BesetzenZeile, sid: number, filter: BesetzenFilter): boolean {
  const a = z.zellen.get(sid);
  switch (filter) {
    case 'an': return a?.status === 'angemeldet' || a?.status === 'bestaetigt';
    case 'neu': return a?.status === 'angemeldet';
    case 'offen': return !!a && OFFEN.includes(a.status);
    case 'bestaetigt': return a?.status === 'bestaetigt';
    case 'ab': return a?.status === 'abgemeldet';
    case 'warnung': return (z.warnungen.get(sid) ?? 0) > 0;
    case 'alle': return !!a;
    case 'nicht': return !a;
  }
}

/**
 * Filter der Liste «Besetzen».
 * Eine Schicht gewählt: der Eintrag in dieser Schicht zählt.
 * Alle Schichten: Eine Schicht mit passendem Eintrag genügt. «Nicht gefragt» heisst dann: kein Eintrag im ganzen Einsatz.
 * «Nicht gefragt» zeigt nur bekannte Personen, die zu Mindestalter und Mindestrang passen (wie die Anrufliste, 14.3).
 */
export function filtereBesetzen(zeilen: BesetzenZeile[], schichtIds: number[], filter: BesetzenFilter, mitUnpassenden = false): BesetzenZeile[] {
  if (filter === 'nicht') {
    return zeilen.filter((z) => z.personId !== null
      && schichtIds.every((sid) => !z.zellen.has(sid))
      && (mitUnpassenden || schichtIds.some((sid) => z.passt.get(sid))));
  }
  return zeilen.filter((z) => schichtIds.some((sid) => passtInSchicht(z, sid, filter)));
}

/** Zahlen für die Filter-Chips. «unpassend» = nicht gefragte Personen, die nicht passen (ausgeblendet). */
export function zaehleBesetzen(zeilen: BesetzenZeile[], schichtIds: number[]): Record<BesetzenFilter, number> & { unpassend: number } {
  const zahl = {} as Record<BesetzenFilter, number>;
  for (const f of BESETZEN_FILTER) zahl[f] = filtereBesetzen(zeilen, schichtIds, f).length;
  return { ...zahl, unpassend: filtereBesetzen(zeilen, schichtIds, 'nicht', true).length - zahl.nicht };
}

/**
 * Vorgabe ohne Filter in der Adresse (Wunsch Yann 20.11.2026): «Neu + Bestätigt».
 * Gibt es niemanden mit «angemeldet» oder «bestätigt», dann «Alle». Ohne Einträge «Nicht gefragt».
 */
export function vorgabeFilter(zahl: Record<BesetzenFilter, number>): BesetzenFilter {
  if (zahl.an) return 'an';
  if (zahl.alle) return 'alle';
  return 'nicht';
}
