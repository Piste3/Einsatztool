// Termin-Titel, Termintext und ICS-Datei nach RFC 5545 (17.1 bis 17.3). Ohne Bibliothek.
import { randomBytes } from 'node:crypto';
import { eine, schreibe, transaktion, type Db } from '../db/db.js';
import { datumChVonIso, jetztIso, lokaleZeit, wochentag } from './zeit.js';

export interface TerminSchicht {
  id: number;
  name: string;
  start_zeit: string;
  end_zeit: string;
  ort: string | null;
  min_alter: number | null;
  bemerkung_extern: string | null;
  einsatz_name: string;
  einsatz_bemerkung_extern: string | null;
  anzahl_schichten: number;
}

/** Regel 17.1: Genau eine Schicht = Name des Einsatzes, sonst «Einsatzname – Schichtname». */
export function terminTitel(s: { einsatz_name: string; name: string; anzahl_schichten: number }): string {
  return Number(s.anzahl_schichten) === 1 ? s.einsatz_name : `${s.einsatz_name} – ${s.name}`;
}

/** Regel 17.1: Text für den Clubdesk-Termin. Leere Felder entfallen. */
export function terminText(s: TerminSchicht): string {
  const zeilen: string[] = [];
  zeilen.push(`Einsatz: ${s.einsatz_name}`);
  zeilen.push(`Schicht: ${s.name}`);
  zeilen.push(`Zeit: ${wochentag(s.start_zeit)} ${datumChVonIso(s.start_zeit)}, ${lokaleZeit(s.start_zeit)}–${lokaleZeit(s.end_zeit)}`);
  if (s.ort) zeilen.push(`Ort: ${s.ort}`);
  if (s.min_alter !== null && s.min_alter !== undefined) zeilen.push(`Mindestalter: ${s.min_alter}`);
  if (s.bemerkung_extern) zeilen.push(`Bemerkung: ${s.bemerkung_extern}`);
  if (s.einsatz_bemerkung_extern) zeilen.push(s.einsatz_bemerkung_extern);
  return zeilen.join('\n');
}

/** Regel 17.2.3: \ ; , und Zeilenumbrüche maskieren. */
export function maskiereIcs(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Regel 17.2.2: Zeilen über 75 Byte falten. Fortsetzung beginnt mit einem Leerzeichen. */
export function falte(zeile: string): string {
  const teile: string[] = [];
  let aktuell = '';
  let bytes = 0;
  let grenze = 75;
  for (const zeichen of zeile) {
    const b = Buffer.byteLength(zeichen, 'utf8');
    if (bytes + b > grenze) {
      teile.push(aktuell);
      aktuell = ' ';
      bytes = 1;
      grenze = 75;
    }
    aktuell += zeichen;
    bytes += b;
  }
  teile.push(aktuell);
  return teile.join('\r\n');
}

/** Zeit im Format 20261118T070000Z (17.2.4). */
export function icsZeit(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function erzeugeIcs(s: TerminSchicht, jetzt = jetztIso()): string {
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Verkehrskadetten//Einsatzplaner//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:schicht-${s.id}-${randomBytes(6).toString('hex')}@einsatzplaner`,
    `DTSTAMP:${icsZeit(jetzt)}`,
    `DTSTART:${icsZeit(s.start_zeit)}`,
    `DTEND:${icsZeit(s.end_zeit)}`,
    `SUMMARY:${maskiereIcs(terminTitel(s))}`,
  ];
  if (s.ort) zeilen.push(`LOCATION:${maskiereIcs(s.ort)}`);
  zeilen.push(`DESCRIPTION:${maskiereIcs(terminText(s))}`);
  zeilen.push('END:VEVENT', 'END:VCALENDAR');
  return zeilen.map(falte).join('\r\n') + '\r\n';
}

/** Regel 17.2.5: Dateiname ohne Sonderzeichen. */
export function icsDateiname(s: { einsatz_name: string; name: string; anzahl_schichten: number }): string {
  const basis = terminTitel(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${basis || 'termin'}.ics`;
}

export interface IcsVermerk {
  exportiert_am: string;
  benutzer: string | null;
}

export async function icsVermerk(db: Db, schichtId: number): Promise<IcsVermerk | undefined> {
  return eine<IcsVermerk>(
    db,
    'SELECT x.exportiert_am, b.name AS benutzer FROM ics_export x LEFT JOIN benutzer b ON b.id = x.benutzer_id WHERE x.schicht_id = ?',
    [schichtId],
  );
}

/** Regel 17.3: Export vermerken (erster Export oder «Trotzdem laden»). */
export async function vermerkeIcsExport(db: Db, schichtId: number, benutzerId: number | null): Promise<void> {
  await transaktion(db, async (c) => {
    await schreibe(
      c,
      `INSERT INTO ics_export (schicht_id, exportiert_am, benutzer_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE exportiert_am = VALUES(exportiert_am), benutzer_id = VALUES(benutzer_id)`,
      [schichtId, jetztIso(), benutzerId],
    );
  });
}
