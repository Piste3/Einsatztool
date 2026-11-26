// Personen lesen und suchen (14.4). Das Tool bearbeitet keine Personendaten (5.7.1).
import { STANDARD_AENDERUNG, fuelleVorlage } from './vorlagen.js';
import { alle, eine, type Db } from '../db/db.js';
import { NichtGefunden } from './eingabe.js';
import { alterAm, lokalesDatum } from './zeit.js';

export interface Person {
  clubdesk_id: number;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: string | null;
  rang_id: number | null;
  rang_name: string | null;
  rang_reihenfolge: number | null;
  strasse: string | null;
  adresszusatz: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  telefon_privat: string | null;
  email: string | null;
  essenseinschraenkung: string | null;
  importiert_am: string;
  geloescht_am: string | null;
}

const PERSON_SQL = `SELECT p.*, r.name AS rang_name, r.reihenfolge AS rang_reihenfolge
  FROM person p LEFT JOIN rang r ON r.id = p.rang_id`;

/**
 * Normalisiert einen Namen für den Vergleich (15.3.2, Entscheid Yann):
 * ohne Gross-/Kleinschreibung, ohne Leerzeichen am Rand, «ä», «ae» und «a» gleich (ebenso ö, ü),
 * Akzente zählen nicht.
 */
export function normalisiereName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/\s+/g, ' ');
}

/** Telefon für die Anzeige: Mobil zuerst, dann Privat, getrennt durch « / » (16.1). */
/** Nummer für die Anzeige: Bindestriche werden Leerzeichen (Wunsch Yann 26.11.2026, «+41-77 411 07 51» → «+41 77 411 07 51»). */
export function nummerAnzeige(nummer: string): string {
  return nummer.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function telefonText(p: { telefon: string | null; telefon_privat: string | null }): string {
  return [p.telefon, p.telefon_privat].filter((t): t is string => !!t && !!t.trim()).map(nummerAnzeige).join(' / ');
}

/** Hauptnummer: Mobil, sonst Privat. */
export function hauptnummer(p: { telefon: string | null; telefon_privat: string | null }): string | null {
  const n = p.telefon?.trim() || p.telefon_privat?.trim();
  return n ? nummerAnzeige(n) : null;
}

/** Nummer für wa.me: nur Ziffern, Schweizer Nummern mit 41. */
export function whatsappNummer(nummer: string | null): string | null {
  if (!nummer) return null;
  let n = nummer.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '41' + n.slice(1);
  return /^\d{8,15}$/.test(n) ? n : null;
}

/** Nummer für tel:-Links. */
export function telLink(nummer: string): string {
  return nummer.replace(/[^\d+]/g, '');
}

export function alterHeute(geburtsdatum: string | null): number | null {
  return geburtsdatum ? alterAm(geburtsdatum, lokalesDatum(new Date())) : null;
}

/** Alle Personen mit Daten (ohne gelöschte), sortiert nach Rang (höchster zuerst), dann Name. */
export async function personenListe(db: Db): Promise<Person[]> {
  return alle<Person>(
    db,
    `${PERSON_SQL} WHERE p.geloescht_am IS NULL
     ORDER BY (r.reihenfolge IS NULL), r.reihenfolge DESC, p.nachname, p.vorname`,
  );
}

export async function ladePerson(db: Db, id: number): Promise<Person> {
  const p = await eine<Person>(db, `${PERSON_SQL} WHERE p.clubdesk_id = ?`, [id]);
  if (!p) throw new NichtGefunden('Person nicht gefunden.');
  return p;
}

/** Sucht Personen (ohne gelöschte) per normalisiertem Vor- und Nachnamen. */
export async function findePersonNachName(db: Db, vorname: string, nachname: string): Promise<number[]> {
  const v = normalisiereName(vorname);
  const n = normalisiereName(nachname);
  const kandidaten = await alle<{ clubdesk_id: number; vorname: string | null; nachname: string | null }>(
    db,
    'SELECT clubdesk_id, vorname, nachname FROM person WHERE geloescht_am IS NULL',
  );
  return kandidaten
    .filter((p) => normalisiereName(p.vorname ?? '') === v && normalisiereName(p.nachname ?? '') === n)
    .map((p) => p.clubdesk_id);
}

/** Wert für Auswahllisten: «Nachname Vorname (ID)». Die Route liest die ID in Klammern. */
export function personAuswahlText(p: { clubdesk_id: number; vorname: string | null; nachname: string | null; rang_name?: string | null }): string {
  const rang = p.rang_name ? `${p.rang_name} ` : '';
  return `${rang}${p.nachname ?? ''} ${p.vorname ?? ''} (${p.clubdesk_id})`.replace(/\s+/g, ' ').trim();
}

/** Liest die Clubdesk-ID aus «… (123)» oder aus einer reinen Zahl. */
export function idAusAuswahl(wert: unknown): number | null {
  if (typeof wert !== 'string') return null;
  const m = /\((\d+)\)\s*$/.exec(wert.trim()) ?? /^(\d+)$/.exec(wert.trim());
  return m ? Number(m[1]) : null;
}

/**
 * «Änderung melden» (14.4): mailto-Link an die Informatik.
 * Der Admin bearbeitet die Vorlage in den Einstellungen. Die Aufgebotsstelle trägt jede Änderung direkt in die Mail ein.
 * Das Tool ändert keine Personendaten.
 */
export function aenderungMailText(
  p: { clubdesk_id: number; vorname?: string | null; nachname?: string | null; rang_name?: string | null },
  name: string,
  vorlage: { betreff: string; text: string } = STANDARD_AENDERUNG,
): { betreff: string; text: string } {
  const werte = { clubdesk_id: p.clubdesk_id, name, vorname: p.vorname ?? '', nachname: p.nachname ?? '', rang: p.rang_name ?? '' };
  return {
    betreff: fuelleVorlage(vorlage.betreff, werte),
    // Mailprogramme erwarten CRLF im mailto-Text.
    text: fuelleVorlage(vorlage.text, werte).replace(/\r?\n/g, '\r\n'),
  };
}

export function aenderungMailto(an: string, m: { betreff: string; text: string }): string {
  return `mailto:${an}?subject=${encodeURIComponent(m.betreff)}&body=${encodeURIComponent(m.text)}`;
}
