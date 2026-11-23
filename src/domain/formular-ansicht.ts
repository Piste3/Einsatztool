// Ansicht eines Eingangs (Wunsch Yann 23.11.2026): das Formular so, wie es beim Ausfüllen aussah,
// mit allen Angaben und der Original-Bemerkung. Nur lesen.
// Eingänge ab Migration 10 haben eine Momentaufnahme. Ältere Eingänge rekonstruiert das Tool aus dem heutigen Stand.
import { alle, eine, type Db } from '../db/db.js';
import { NichtGefunden } from './eingabe.js';
import {
  FORMULAR_SCHICHT_SQL, type FormularEingabeAufnahme, type FormularMomentaufnahme, type FormularSchicht,
} from './formular.js';

export interface SpaeterBearbeitet {
  schicht_id: number;
  schicht_name: string;
  einsatz_name: string;
  /** Bemerkung, wie die Person sie im Formular geschrieben hat. */
  original: string | null;
  /** Bemerkung der Anmeldung heute. */
  aktuell: string | null;
  zeit: string;
  benutzer: string | null;
}

export interface FormularAnsicht {
  id: number;
  zeit: string;
  name: string | null;
  person_id: number | null;
  /** «momentaufnahme» = gespeichert beim Absenden. «rekonstruiert» = aus dem heutigen Stand zusammengesetzt. */
  art: 'momentaufnahme' | 'rekonstruiert';
  /** Eingang vor dem 20.11.2026 (nachgetragen durch Migration 7). */
  nachgetragen: boolean;
  /** Die Personendaten sind gelöscht (Austritt). Name und Bemerkungen fehlen. */
  geloescht: boolean;
  schichten: FormularSchicht[];
  gewaehlt: number[];
  vorname: string;
  nachname: string;
  bemerkungen: Record<string, string>;
  /** Herkunft der Bemerkungen bei rekonstruierten Eingängen. */
  bemerkungAusProtokoll: boolean;
  /** Bemerkungen, die ein Benutzer nach dem Eingang bearbeitet hat. */
  spaeter: SpaeterBearbeitet[];
}

const MEHRDEUTIG = /\n?Mehrdeutig: Clubdesk-IDs [\d, ]+$/;

function json<T>(wert: unknown): T | null {
  if (typeof wert !== 'string' || !wert) return null;
  try {
    return JSON.parse(wert) as T;
  } catch {
    return null;
  }
}

/** Reihenfolge wie im Formular: Einsatz nach erster Schicht, dann Schichten nach Beginn. */
function sortiere(liste: FormularSchicht[]): FormularSchicht[] {
  const erste = new Map<number, string>();
  for (const s of liste) {
    const x = erste.get(s.einsatz_id);
    if (x === undefined || s.start_zeit < x) erste.set(s.einsatz_id, s.start_zeit);
  }
  return [...liste].sort((a, b) =>
    erste.get(a.einsatz_id)!.localeCompare(erste.get(b.einsatz_id)!) || a.einsatz_id - b.einsatz_id
    || a.start_zeit.localeCompare(b.start_zeit) || a.id - b.id);
}

/** Teilt einen Namen beim ersten Leerzeichen (nur für rekonstruierte Eingänge). */
function teileName(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}

export async function formularAnsicht(db: Db, id: number): Promise<FormularAnsicht> {
  const e = await eine<{ id: number; zeit: string; name: string | null; person_id: number | null; nachgetragen: number; formular: string | null; eingabe: string | null }>(
    db, 'SELECT id, zeit, name, person_id, nachgetragen, formular, eingabe FROM formular_eingang WHERE id = ?', [id],
  );
  if (!e) throw new NichtGefunden('Eingang nicht gefunden.');
  const fs = await alle<{ schicht_id: number; schicht_name: string; einsatz_id: number; einsatz_name: string; anmeldung_id: number | null; bemerkung: string | null; neu: number; anmeldung_bemerkung: string | null }>(
    db,
    `SELECT fs.schicht_id, s.name AS schicht_name, s.einsatz_id, e.name AS einsatz_name, fs.anmeldung_id, fs.bemerkung, fs.neu,
            a.bemerkung AS anmeldung_bemerkung
       FROM formular_eingang_schicht fs JOIN schicht s ON s.id = fs.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
       LEFT JOIN anmeldung a ON a.id = fs.anmeldung_id
      WHERE fs.eingang_id = ? ORDER BY s.start_zeit, s.id`,
    [id],
  );
  const geloescht = (e.name ?? '').startsWith('Gelöschte Person ');
  const moment = json<FormularMomentaufnahme>(e.formular);
  const eingabe = geloescht ? null : json<FormularEingabeAufnahme>(e.eingabe);

  let art: FormularAnsicht['art'];
  let schichten: FormularSchicht[];
  let gewaehlt: number[];
  let vorname = '';
  let nachname = '';
  let bemerkungen: Record<string, string> = {};
  let bemerkungAusProtokoll = false;

  if (moment && Array.isArray(moment.schichten)) {
    art = 'momentaufnahme';
    schichten = moment.schichten;
    gewaehlt = (moment.gewaehlt ?? []).map(Number);
  } else {
    // Rekonstruktion: Das Tool kennt nicht, welche Schichten damals publiziert waren.
    // Es nimmt die heute publizierten Schichten, die damals noch nicht vorbei waren, aus Einsätzen, die es damals schon gab.
    // Dazu kommen immer die gewählten Schichten.
    art = 'rekonstruiert';
    gewaehlt = fs.map((x) => x.schicht_id);
    schichten = await alle<FormularSchicht>(
      db,
      `${FORMULAR_SCHICHT_SQL}
        WHERE (s.publiziert = 1 AND s.end_zeit > ? AND e.erstellt_am <= ?)${gewaehlt.length ? ' OR s.id IN (?)' : ''}`,
      gewaehlt.length ? [e.zeit, e.zeit, gewaehlt] : [e.zeit, e.zeit],
    );
    schichten = sortiere(schichten);
  }

  if (eingabe) {
    vorname = eingabe.vorname ?? '';
    nachname = eingabe.nachname ?? '';
    bemerkungen = { ...(eingabe.bemerkungen ?? {}) };
    // Älteres Formular: eine Bemerkung für alle Schichten. Sie steht dann bei jedem gewählten Einsatz.
    if (eingabe.bemerkung) {
      for (const x of fs) bemerkungen[String(x.einsatz_id)] = bemerkungen[String(x.einsatz_id)] ? `${eingabe.bemerkung}\n${bemerkungen[String(x.einsatz_id)]}` : eingabe.bemerkung;
    }
  } else if (!geloescht) {
    [vorname, nachname] = teileName(e.name ?? '');
    for (const x of fs) {
      const schluessel = String(x.einsatz_id);
      if (bemerkungen[schluessel]) continue;
      let b = x.bemerkung;
      if (!b && e.nachgetragen && x.anmeldung_id !== null && x.neu) {
        // Eingang vor dem 20.11.2026: Die erste Bemerkung der Anmeldung steht im Statusprotokoll (Wert vor der ersten Änderung).
        const erste = await eine<{ alt_wert: string | null }>(
          db, "SELECT alt_wert FROM status_log WHERE anmeldung_id = ? AND aktion = 'bemerkung' ORDER BY zeit, id LIMIT 1", [x.anmeldung_id],
        );
        b = erste ? erste.alt_wert : x.anmeldung_bemerkung;
        if (b) {
          b = b.replace(MEHRDEUTIG, '') || null;
          bemerkungAusProtokoll = true;
        }
      }
      if (b) bemerkungen[schluessel] = b;
    }
  }

  // Später von einem Benutzer bearbeitet: Eintrag im Statusprotokoll mit Benutzer nach dem Eingang.
  const spaeter: SpaeterBearbeitet[] = [];
  if (!geloescht) {
    for (const x of fs) {
      if (x.anmeldung_id === null) continue;
      const letzte = await eine<{ zeit: string; benutzer: string | null }>(
        db,
        `SELECT l.zeit, b.name AS benutzer FROM status_log l LEFT JOIN benutzer b ON b.id = l.benutzer_id
          WHERE l.anmeldung_id = ? AND l.aktion = 'bemerkung' AND l.benutzer_id IS NOT NULL AND l.zeit >= ?
          ORDER BY l.zeit DESC, l.id DESC LIMIT 1`,
        [x.anmeldung_id, e.zeit],
      );
      if (!letzte) continue;
      spaeter.push({
        schicht_id: x.schicht_id, schicht_name: x.schicht_name, einsatz_name: x.einsatz_name,
        original: bemerkungen[String(x.einsatz_id)] ?? x.bemerkung ?? null, aktuell: x.anmeldung_bemerkung, zeit: letzte.zeit, benutzer: letzte.benutzer,
      });
    }
  }

  return {
    id: e.id, zeit: e.zeit, name: e.name, person_id: e.person_id, art, nachgetragen: !!e.nachgetragen, geloescht,
    schichten, gewaehlt, vorname, nachname, bemerkungen, bemerkungAusProtokoll, spaeter,
  };
}
