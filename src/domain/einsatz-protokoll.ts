// Protokoll für Einsatz und Schichten (Wunsch Yann 26.11.2026): Erstellen, Ändern, Publizieren, Kopieren, Löschen.
// Der Reiter «Verlauf» zeigt es zusammen mit dem Statusprotokoll der Anmeldungen.
// Das Protokoll speichert lesbare Werte (z. B. «Sa 14.11.2026 06:45», Name des Rangs). So bleibt es lesbar,
// auch wenn jemand später einen Rang oder eine Schicht löscht.
import { alle, eine, schreibe, type Db } from '../db/db.js';
import { datumChVonIso, jetztIso, lokaleZeit, wochentagKurz } from './zeit.js';

export type ProtokollAktion =
  | 'einsatz_erstellt'
  | 'einsatz_kopiert'
  | 'einsatz_geaendert'
  | 'schicht_erstellt'
  | 'schicht_kopiert'
  | 'schicht_geaendert'
  | 'vererbt'
  | 'publiziert'
  | 'nicht_publiziert'
  | 'schicht_geloescht'
  | 'fremdabteilung_erfasst'
  | 'fremdabteilung_geaendert'
  | 'fremdabteilung_geloescht';

export interface ProtokollEintrag {
  aktion: ProtokollAktion;
  schichtId?: number | null;
  schichtName?: string | null;
  feld?: string | null;
  alt?: string | null;
  neu?: string | null;
}

/** Schreibt Einträge ins Protokoll. Läuft in der Transaktion der Änderung. */
export async function protokolliere(c: Db, einsatzId: number, benutzerId: number | null, eintraege: ProtokollEintrag[]): Promise<void> {
  const zeit = jetztIso();
  for (const e of eintraege) {
    await schreibe(
      c,
      `INSERT INTO einsatz_protokoll (zeit, einsatz_id, schicht_id, schicht_name, benutzer_id, aktion, feld, alt, neu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [zeit, einsatzId, e.schichtId ?? null, e.schichtName ?? null, benutzerId, e.aktion, e.feld ?? null, e.alt ?? null, e.neu ?? null],
    );
  }
}

/** Lesbare Werte eines Feldes: Bezeichnung → Text. Leer = «». */
export type Stand = Map<string, string>;

/** Unterschiede zwischen zwei Ständen, in der Reihenfolge der Felder. */
export function unterschiede(alt: Stand, neu: Stand): { feld: string; alt: string; neu: string }[] {
  const felder = [...new Set([...alt.keys(), ...neu.keys()])];
  return felder
    .map((feld) => ({ feld, alt: alt.get(feld) ?? '', neu: neu.get(feld) ?? '' }))
    .filter((u) => u.alt !== u.neu);
}

const t = (w: unknown) => (w === null || w === undefined ? '' : String(w));

/** Bezeichnungen der Felder, die vom Einsatz auf die Schichten vererbt werden. */
export const FELD_TEXT: Record<string, string> = {
  ort: 'Ort Antreten',
  abtreten_ort: 'Ort Abtreten',
  tenue: 'Tenue',
  aufgebot_hinweis: 'Hinweis Aufgebot',
};

/** Stand eines Einsatzes (ohne Schichten). */
export function einsatzStand(e: {
  name: string; ort: string | null; abtreten_ort: string | null; tenue: string | null; aufgebot_hinweis: string | null;
  bemerkung_intern: string | null; bemerkung_extern: string | null; formular_mehrere: number;
}): Stand {
  return new Map([
    ['Name', t(e.name)],
    [FELD_TEXT.ort, t(e.ort)],
    [FELD_TEXT.abtreten_ort, t(e.abtreten_ort)],
    [FELD_TEXT.tenue, t(e.tenue)],
    [FELD_TEXT.aufgebot_hinweis, t(e.aufgebot_hinweis)],
    ['Bemerkung intern', t(e.bemerkung_intern)],
    ['Bemerkung extern', t(e.bemerkung_extern)],
    ['Im Formular mehrere Schichten wählbar', Number(e.formular_mehrere) ? 'ja' : 'nein'],
  ]);
}

/** Zeitpunkt lesbar, z. B. «Sa 14.11.2026 06:45». Bei offener Zeit steht «Zeit offen». */
function wann(iso: string, offen: boolean, platzhalter: string): string {
  const zeit = lokaleZeit(iso);
  return `${wochentagKurz(iso)} ${datumChVonIso(iso)} ${offen && zeit === platzhalter ? 'Zeit offen' : zeit}`;
}

/** Stand einer Schicht aus der Datenbank, mit Rang und Rollenbedarf. Null = Schicht gibt es nicht. */
export async function schichtStand(c: Db, schichtId: number): Promise<{ einsatzId: number; name: string; publiziert: boolean; stand: Stand } | null> {
  const s = await eine<any>(
    c,
    'SELECT s.*, r.name AS rang_name FROM schicht s LEFT JOIN rang r ON r.id = s.min_rang_id WHERE s.id = ?',
    [schichtId],
  );
  if (!s) return null;
  const offen = Number(s.zeit_offen) === 1;
  const stand: Stand = new Map([
    ['Name', t(s.name)],
    ['Beginn', wann(s.start_zeit, offen, '00:00')],
    ['Ende', wann(s.end_zeit, offen, '23:59')],
    ['Soll (TN)', t(s.soll_anzahl)],
    ['Mindestalter', t(s.min_alter)],
    ['Mindestrang', t(s.rang_name)],
    [FELD_TEXT.ort, t(s.ort)],
    [FELD_TEXT.abtreten_ort, t(s.abtreten_ort)],
    [FELD_TEXT.tenue, t(s.tenue)],
    [FELD_TEXT.aufgebot_hinweis, t(s.aufgebot_hinweis)],
    ['Bemerkung intern', t(s.bemerkung_intern)],
    ['Bemerkung extern', t(s.bemerkung_extern)],
  ]);
  const rollen = await alle<{ rolle: string; anzahl: number }>(c, 'SELECT rolle, anzahl FROM schicht_rolle WHERE schicht_id = ? ORDER BY rolle', [schichtId]);
  for (const r of rollen) stand.set(`Bedarf ${r.rolle}`, String(r.anzahl));
  return { einsatzId: Number(s.einsatz_id), name: s.name, publiziert: Number(s.publiziert) === 1, stand };
}

export interface ProtokollZeile {
  zeit: string;
  aktion: ProtokollAktion;
  schicht_id: number | null;
  schicht_name: string | null;
  feld: string | null;
  alt: string | null;
  neu: string | null;
  benutzer: string | null;
}

/** Die neuesten Einträge des Protokolls eines Einsatzes. */
export async function protokollEinsatz(db: Db, einsatzId: number, grenze = 300): Promise<ProtokollZeile[]> {
  return alle<ProtokollZeile>(
    db,
    `SELECT p.zeit, p.aktion, p.schicht_id, p.schicht_name, p.feld, p.alt, p.neu, b.name AS benutzer
       FROM einsatz_protokoll p LEFT JOIN benutzer b ON b.id = p.benutzer_id
      WHERE p.einsatz_id = ?
      ORDER BY p.zeit DESC, p.id DESC
      LIMIT ?`,
    [einsatzId, grenze],
  );
}

/** Kurzer Wert für die Anzeige. Lange Texte kürzt das Tool. */
function kurz(w: string | null): string {
  const x = (w ?? '').replace(/\s+/g, ' ').trim();
  if (!x) return '(leer)';
  return x.length > 120 ? `${x.slice(0, 119)}…` : `«${x}»`;
}

/** Text der Änderung für den Reiter «Verlauf». */
export function protokollText(p: Pick<ProtokollZeile, 'aktion' | 'feld' | 'alt' | 'neu'>): string {
  const aenderung = `${p.feld}: ${kurz(p.alt)} → ${kurz(p.neu)}`;
  switch (p.aktion) {
    case 'einsatz_erstellt': return 'Einsatz erstellt';
    case 'einsatz_kopiert': return `Einsatz erstellt als Kopie von ${kurz(p.alt)}`;
    case 'einsatz_geaendert': return aenderung;
    case 'schicht_erstellt': return 'Schicht erstellt (nicht publiziert)';
    case 'schicht_kopiert': return `Schicht erstellt als Kopie von ${kurz(p.alt)} (nicht publiziert)`;
    case 'schicht_geaendert': return aenderung;
    case 'vererbt': return `${aenderung} (vom Einsatz übernommen)`;
    case 'publiziert': return 'Publiziert';
    case 'nicht_publiziert': return 'Nicht mehr publiziert';
    case 'schicht_geloescht': return p.neu ? `Schicht gelöscht (${p.neu})` : 'Schicht gelöscht';
    case 'fremdabteilung_erfasst': return `Fremdabteilung erfasst: ${kurz(p.neu)}`;
    case 'fremdabteilung_geaendert': return `Fremdabteilung geändert: ${kurz(p.alt)} → ${kurz(p.neu)}`;
    case 'fremdabteilung_geloescht': return `Fremdabteilung gelöscht: ${kurz(p.alt)}`;
    default: return String(p.aktion);
  }
}
