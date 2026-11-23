// Handyversion (Wunsch Yann 23.11.2026): eigene, einfache Oberfläche für Smartphones.
// Nur Eintragen und Ansicht nach Person. Anlegen von Einsätzen und Schichten geht nur in der vollen Version.
import { alle, type Db } from '../db/db.js';
import type { Status } from './eingabe.js';
import { passtZuSchicht } from './warnungen.js';
import { jetztIso } from './zeit.js';

/** Cookie für die Wahl der Ansicht. «voll» = volle Version auch auf dem Handy, «handy» = Handyversion. */
export const ANSICHT_COOKIE = 'ansicht';

/**
 * Erkennt ein Smartphone am User-Agent. Tablets (iPad, Android ohne «Mobile») erhalten die volle Version.
 * Grund: Auf einem Tablet passt die volle Version.
 */
export function istHandy(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  if (/iPad|Tablet/i.test(userAgent)) return false;
  return /iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i.test(userAgent);
}

/**
 * Öffnet die Startseite die Handyversion? Ja bei einem Smartphone, ausser der Benutzer hat die volle Version gewählt.
 * Die Wahl «handy» öffnet die Handyversion auf jedem Gerät.
 */
export function startInHandy(userAgent: string | undefined, ansicht: string | undefined): boolean {
  if (ansicht === 'voll') return false;
  if (ansicht === 'handy') return true;
  return istHandy(userAgent);
}

export interface PersonSchicht {
  schicht_id: number;
  schicht: string;
  einsatz_id: number;
  einsatz: string;
  start_zeit: string;
  end_zeit: string;
  zeit_offen: number;
  publiziert: number;
  /** Eintrag der Person. Leer = nicht gefragt. */
  anmeldung_id: number | null;
  version: number | null;
  status: Status | null;
  rolle: string | null;
  bemerkung: string | null;
  /** Passt die Person zu Mindestalter und Mindestrang? */
  passt: boolean;
}

export interface PersonEinsatz {
  einsatz_id: number;
  einsatz: string;
  schichten: PersonSchicht[];
}

/**
 * Ansicht nach Person: alle kommenden Schichten, mit und ohne Eintrag, nach Einsatz gruppiert.
 * Eine Schicht ohne Eintrag heisst «nicht gefragt». Unpublizierte Schichten zählen mit (wie auf der Personenseite).
 */
export async function personStatus(db: Db, person: { clubdesk_id: number; geburtsdatum: string | null; rang_reihenfolge: number | null }): Promise<PersonEinsatz[]> {
  const zeilen = await alle<any>(
    db,
    `SELECT s.id AS schicht_id, s.name AS schicht, e.id AS einsatz_id, e.name AS einsatz, s.start_zeit, s.end_zeit, s.zeit_offen, s.publiziert,
            s.min_alter, r.reihenfolge AS min_rang_reihenfolge,
            a.id AS anmeldung_id, a.version, a.status, a.rolle, a.bemerkung
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id
       LEFT JOIN rang r ON r.id = s.min_rang_id
       LEFT JOIN anmeldung a ON a.schicht_id = s.id AND a.person_id = ?
      WHERE s.end_zeit > ?
      ORDER BY s.start_zeit, e.id, s.position, s.id`,
    [person.clubdesk_id, jetztIso()],
  );
  const einsaetze: PersonEinsatz[] = [];
  const nachId = new Map<number, PersonEinsatz>();
  for (const z of zeilen) {
    let e = nachId.get(z.einsatz_id);
    if (!e) {
      e = { einsatz_id: z.einsatz_id, einsatz: z.einsatz, schichten: [] };
      nachId.set(z.einsatz_id, e);
      einsaetze.push(e);
    }
    e.schichten.push({
      schicht_id: z.schicht_id, schicht: z.schicht, einsatz_id: z.einsatz_id, einsatz: z.einsatz,
      start_zeit: z.start_zeit, end_zeit: z.end_zeit, zeit_offen: Number(z.zeit_offen), publiziert: Number(z.publiziert),
      anmeldung_id: z.anmeldung_id, version: z.version, status: z.status, rolle: z.rolle, bemerkung: z.bemerkung,
      passt: passtZuSchicht(person, { start_zeit: z.start_zeit, min_alter: z.min_alter, min_rang_reihenfolge: z.min_rang_reihenfolge }),
    });
  }
  return einsaetze;
}

/** Zahlen für den Kopf der Ansicht nach Person: je Status und «nicht gefragt». */
export function zaehlePersonStatus(einsaetze: PersonEinsatz[]): Record<Status | 'nicht', number> {
  const z: Record<Status | 'nicht', number> = { angemeldet: 0, bestaetigt: 0, unsicher: 0, nachricht_gesendet: 0, abgemeldet: 0, nicht: 0 };
  for (const e of einsaetze) for (const s of e.schichten) z[s.status ?? 'nicht']++;
  return z;
}
