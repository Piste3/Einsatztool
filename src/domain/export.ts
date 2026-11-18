// Exporte: Tagesexport (19.1), Essensliste (19.2), Teilnehmerliste (19.3).
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alle, type Db } from '../db/db.js';
import { schreibeSicherung } from '../db/sicherung.js';
import { csvText } from './csv.js';
import { STATUS_TEXT, KANAL_TEXT, type Kanal, type Status } from './eingabe.js';
import { telefonText } from './personen.js';
import { ladeSchicht } from './schicht.js';
import { zahlenFuerSchichten } from './zaehlung.js';
import { datumChVonIso, isoUtc, jetztIso, lokalesDatum, lokaleZeit, plusTage, tageZwischen } from './zeit.js';
import type { SharePoint } from './sharepoint.js';

/** Regel 19.1.2: uebersicht.csv, eine Zeile je Anmeldung, Schichten mit Ende in der Zukunft oder in den letzten 30 Tagen. */
export async function uebersichtCsv(db: Db, jetzt = new Date()): Promise<string> {
  const grenze = isoUtc(new Date(jetzt.getTime() - 30 * 86400000));
  const z = await alle<any>(
    db,
    `SELECT e.name AS einsatz, s.name AS schicht, s.start_zeit, s.end_zeit, s.ort, a.name_text, a.status, a.rolle, a.kanal,
            p.telefon, p.telefon_privat, COALESCE(p.email, a.email_text) AS email, p.essenseinschraenkung, a.bemerkung
       FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
       LEFT JOIN person p ON p.clubdesk_id = a.person_id
      WHERE s.end_zeit > ?
      ORDER BY s.start_zeit, e.name, s.name, a.name_text`,
    [grenze],
  );
  const zeilen: unknown[][] = [
    ['Einsatz', 'Schicht', 'Datum', 'Start', 'Ende', 'Ort', 'Name', 'Status', 'Rolle', 'Kanal', 'Telefon', 'E-Mail', 'Essenseinschränkung', 'Bemerkung'],
  ];
  for (const r of z) {
    zeilen.push([
      r.einsatz, r.schicht, datumChVonIso(r.start_zeit), lokaleZeit(r.start_zeit), lokaleZeit(r.end_zeit), r.ort, r.name_text,
      STATUS_TEXT[r.status as Status], r.rolle, KANAL_TEXT[r.kanal as Kanal], telefonText(r), r.email, r.essenseinschraenkung, r.bemerkung,
    ]);
  }
  return csvText(zeilen);
}

/** Regel 19.1.2: personen.csv. Gelöschte Personen fehlen. */
export async function personenCsv(db: Db): Promise<string> {
  const z = await alle<any>(
    db,
    `SELECT p.vorname, p.nachname, r.name AS rang, p.telefon, p.telefon_privat, p.email, p.essenseinschraenkung
       FROM person p LEFT JOIN rang r ON r.id = p.rang_id
      WHERE p.geloescht_am IS NULL ORDER BY p.nachname, p.vorname`,
  );
  const zeilen: unknown[][] = [['Name', 'Rang', 'Telefon', 'E-Mail', 'Essenseinschränkung']];
  for (const r of z) zeilen.push([`${r.vorname ?? ''} ${r.nachname ?? ''}`.trim(), r.rang, telefonText(r), r.email, r.essenseinschraenkung]);
  return csvText(zeilen);
}

/** Regel 19.2: Essensliste einer Schicht. */
export async function essenslisteCsv(db: Db, schichtId: number): Promise<string> {
  await ladeSchicht(db, schichtId);
  const zahlen = (await zahlenFuerSchichten(db, [schichtId])).get(schichtId)!;
  const personen = await alle<any>(
    db,
    `SELECT a.name_text, a.rolle, p.essenseinschraenkung FROM anmeldung a JOIN person p ON p.clubdesk_id = a.person_id
      WHERE a.schicht_id = ? AND a.status = 'bestaetigt' AND p.essenseinschraenkung IS NOT NULL AND p.essenseinschraenkung <> ''
      ORDER BY a.name_text`,
    [schichtId],
  );
  const fremd = await alle<any>(db, 'SELECT name, anzahl, bemerkung FROM fremdabteilung WHERE schicht_id = ? ORDER BY id', [schichtId]);
  const zeilen: unknown[][] = [['Total Essen', zahlen.essen]];
  zeilen.push(['Name', 'Rolle', 'Essenseinschränkung']);
  for (const p of personen) zeilen.push([p.name_text, p.rolle, p.essenseinschraenkung]);
  if (fremd.length) {
    zeilen.push(['Fremdabteilung', 'Anzahl', 'Bemerkung']);
    for (const f of fremd) zeilen.push([f.name, f.anzahl, f.bemerkung]);
  }
  return csvText(zeilen);
}

/** Regel 19.3: Teilnehmerliste eines Einsatzes. Eine Zeile je bestätigtem Eintrag. */
export async function teilnehmerlisteCsv(db: Db, einsatzId: number): Promise<string> {
  const z = await alle<any>(
    db,
    `SELECT s.name AS schicht, a.name_text, a.rolle, p.telefon, p.telefon_privat, p.essenseinschraenkung
       FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id LEFT JOIN person p ON p.clubdesk_id = a.person_id
      WHERE s.einsatz_id = ? AND a.status = 'bestaetigt'
      ORDER BY s.start_zeit, s.id, a.name_text`,
    [einsatzId],
  );
  const zeilen: unknown[][] = [['Schicht', 'Name', 'Rolle', 'Telefon', 'Essenseinschränkung']];
  for (const r of z) zeilen.push([r.schicht, r.name_text, r.rolle, telefonText(r), r.essenseinschraenkung]);
  return csvText(zeilen);
}

export interface TagesexportErgebnis {
  ok: boolean;
  meldungen: string[];
  sicherung: string;
}

/** Datei atomar schreiben: erst temporär, dann umbenennen. */
function schreibeAtomar(datei: string, inhalt: string | Buffer): void {
  const tmp = `${datei}.tmp`;
  writeFileSync(tmp, inhalt);
  renameSync(tmp, datei);
}

const SICHERUNG_MUSTER = /^datenbank-(\d{4}-\d{2}-\d{2})\.sql$/;

/**
 * Regel 19.1: Tagesexport. Zwei CSV-Dateien in EXPORT_DIR/aktuell/ (überschrieben),
 * eine Datenbankkopie in EXPORT_DIR/backup/, Upload nach SharePoint, Kopien älter als 14 Tage löschen.
 * Schlägt der Upload fehl, bleiben die lokalen Dateien liegen.
 */
export async function tagesexport(db: Db, exportDir: string, sharepoint: SharePoint | null, jetzt = new Date()): Promise<TagesexportErgebnis> {
  const meldungen: string[] = [];
  const aktuell = join(exportDir, 'aktuell');
  const backup = join(exportDir, 'backup');
  mkdirSync(aktuell, { recursive: true });
  mkdirSync(backup, { recursive: true });
  const heute = lokalesDatum(jetzt);

  const uebersicht = await uebersichtCsv(db, jetzt);
  const personen = await personenCsv(db);
  schreibeAtomar(join(aktuell, 'uebersicht.csv'), uebersicht);
  schreibeAtomar(join(aktuell, 'personen.csv'), personen);
  const sicherungName = `datenbank-${heute}.sql`;
  const sicherungPfad = join(backup, sicherungName);
  await schreibeSicherung(db, `${sicherungPfad}.tmp`);
  renameSync(`${sicherungPfad}.tmp`, sicherungPfad);
  meldungen.push(`CSV-Dateien und ${sicherungName} geschrieben.`);

  // Regel 19.1.6: Kopien älter als 14 Tage löschen.
  const zuAlt = (name: string) => {
    const m = SICHERUNG_MUSTER.exec(name);
    return !!m && tageZwischen(m[1], heute) > 14;
  };
  for (const name of readdirSync(backup)) {
    if (zuAlt(name)) {
      unlinkSync(join(backup, name));
      meldungen.push(`Lokal gelöscht: ${name}`);
    }
  }

  let ok = true;
  if (sharepoint) {
    try {
      await sharepoint.lade('aktuell', 'uebersicht.csv', Buffer.from(uebersicht, 'utf8'));
      await sharepoint.lade('aktuell', 'personen.csv', Buffer.from(personen, 'utf8'));
      // Auch Kopien früherer Tage, deren Upload fehlschlug, gehen jetzt hoch.
      const vorhanden = new Set((await sharepoint.liste('backup')).map((d) => d.name));
      for (const name of readdirSync(backup).filter((n) => SICHERUNG_MUSTER.test(n)).sort()) {
        if (name === sicherungName || !vorhanden.has(name)) {
          await sharepoint.lade('backup', name, readFileSync(join(backup, name)));
        }
      }
      for (const d of await sharepoint.liste('backup')) {
        if (zuAlt(d.name)) {
          await sharepoint.loesche(d.id);
          meldungen.push(`SharePoint gelöscht: ${d.name}`);
        }
      }
      meldungen.push('Upload nach SharePoint erfolgreich.');
    } catch (e) {
      ok = false;
      meldungen.push(`Upload nach SharePoint fehlgeschlagen: ${(e as Error).message}`);
    }
  } else {
    meldungen.push('SharePoint ist nicht eingerichtet. Kein Upload.');
  }
  return { ok, meldungen, sicherung: sicherungPfad };
}

/** Hilfe für Tests und Anzeige: Datum vor n Tagen. */
export function datumVor(tage: number, jetzt = new Date()): string {
  return plusTage(lokalesDatum(jetzt), -tage);
}

export { jetztIso };
