// Text für den Clubdesk-Termin (Wunsch Yann 20.11.2026).
// Der Admin pflegt Titel und Text in Admin › Einstellungen. Bausteine in geschweiften Klammern,
// z. B. {ort}, füllt das Tool je Schicht aus. Ohne gespeicherte Vorlage gilt die Standardvorlage.
// Regel: Eine Zeile mit Bausteinen, die alle leer sind, entfällt (wie «Leere Felder entfallen», 17.1).
import { alle, type Db } from '../db/db.js';
import { ladeSchicht, type SchichtMitEinsatz } from './schicht.js';
import { terminTitel } from './ics.js';
import { ladeVorlage, CLUBDESK_TERMIN } from './vorlagen.js';
import { datumChVonIso, lokaleZeit, wochentag, wochentagKurz, zeitraumText } from './zeit.js';

/** Bausteine mit Erklärung für die Einstellungsseite. Die Reihenfolge ist die Reihenfolge der Liste. */
export const BAUSTEINE: Record<string, string> = {
  '{titel}': 'Titel: Einsatz, bei mehreren Schichten «Einsatz – Schicht»',
  '{einsatz}': 'Name des Einsatzes',
  '{schicht}': 'Name der Schicht',
  '{wochentag}': 'Wochentag, z. B. Samstag',
  '{datum}': 'Datum, z. B. 21.11.2026',
  '{beginn}': 'Beginn, z. B. 12:30 (leer bei «Zeit offen»)',
  '{ende}': 'Ende, z. B. 23:00 (leer bei «Zeit offen»)',
  '{zeit}': 'Datum und Zeit, z. B. Sa 21.11.2026, 12:30–23:00',
  '{ort}': 'Ort (Antreten)',
  '{abtreten}': 'Ort Abtreten',
  '{tenue}': 'Tenue',
  '{hinweis}': 'Hinweis Aufgebot',
  '{mindestalter}': 'Mindestalter',
  '{mindestrang}': 'Mindestrang',
  '{bemerkung}': 'Bemerkung extern der Schicht',
  '{einsatz_bemerkung}': 'Bemerkung extern des Einsatzes',
  '{einsatzleitung}': 'Einsatzleitung (angemeldet oder bestätigt)',
  '{schichten}': 'Alle Schichten des Einsatzes, eine Zeile je Schicht',
  '{formular}': 'Link zum Anmeldeformular',
};

export type Bausteinwerte = Record<string, string>;

/**
 * Setzt die Werte ein. Eine Zeile mit mindestens einem Baustein, deren Bausteine alle leer sind, entfällt.
 * Unbekannte Bausteine bleiben stehen. Mehr als eine Leerzeile hintereinander wird zu einer.
 */
export function fuelleClubdeskVorlage(vorlage: string, werte: Bausteinwerte): string {
  const zeilen: string[] = [];
  for (const zeile of vorlage.replace(/\r\n?/g, '\n').split('\n')) {
    const namen = [...zeile.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((n) => n in werte);
    if (namen.length > 0 && namen.every((n) => !werte[n])) continue;
    zeilen.push(zeile.replace(/\{([a-z_]+)\}/g, (ganz, n: string) => (n in werte ? werte[n] : ganz)));
  }
  return zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Datum und Zeit einer Schicht als Text. Bei «Zeit offen» ohne Uhrzeit. */
function zeitText(s: { start_zeit: string; end_zeit: string; zeit_offen?: number }): string {
  if (Number(s.zeit_offen)) return `${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit)}, Zeit offen`;
  return zeitraumText(s.start_zeit, s.end_zeit);
}

/** Werte aller Bausteine für eine Schicht. */
export async function bausteinwerte(db: Db, s: SchichtMitEinsatz, baseUrl: string): Promise<Bausteinwerte> {
  const schichten = await alle<{ name: string; start_zeit: string; end_zeit: string; zeit_offen: number }>(
    db,
    'SELECT name, start_zeit, end_zeit, zeit_offen FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit, position, id',
    [s.einsatz_id],
  );
  // Einsatzleitung wie im Aufgebot (Regel 20.3): Rolle «Einsatzleitung», hier angemeldet oder bestätigt.
  const el = await alle<{ person_id: number | null; name_text: string | null; vorname: string | null; nachname: string | null; rang: string | null }>(
    db,
    `SELECT a.person_id, a.name_text, p.vorname, p.nachname, r.name AS rang
       FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
      WHERE a.schicht_id = ? AND a.rolle = 'Einsatzleitung' AND a.status IN ('angemeldet', 'bestaetigt') AND p.geloescht_am IS NULL
      ORDER BY (r.reihenfolge IS NULL), r.reihenfolge DESC, p.nachname, p.vorname, a.name_text`,
    [s.id],
  );
  const offen = Number(s.zeit_offen) === 1;
  return {
    titel: terminTitel(s),
    einsatz: s.einsatz_name,
    schicht: s.name,
    wochentag: wochentag(s.start_zeit),
    datum: datumChVonIso(s.start_zeit),
    beginn: offen ? '' : lokaleZeit(s.start_zeit),
    ende: offen ? '' : lokaleZeit(s.end_zeit),
    zeit: zeitText(s),
    ort: s.ort ?? '',
    abtreten: s.abtreten_ort ?? '',
    tenue: s.tenue ?? '',
    hinweis: s.aufgebot_hinweis ?? '',
    mindestalter: s.min_alter !== null && s.min_alter !== undefined ? String(s.min_alter) : '',
    mindestrang: s.min_rang_name ?? '',
    bemerkung: s.bemerkung_extern ?? '',
    einsatz_bemerkung: s.einsatz_bemerkung_extern ?? '',
    einsatzleitung: el
      .map((e) => (e.person_id ? [e.rang, e.vorname, e.nachname].filter(Boolean).join(' ') : (e.name_text ?? '')))
      .filter(Boolean)
      .join(', '),
    schichten: schichten.map((x) => `${x.name}: ${zeitText(x)}`).join('\n'),
    formular: `${baseUrl}/anmeldung`,
  };
}

/** Fertiger Titel und Text für den Clubdesk-Termin einer Schicht. */
export async function clubdeskText(db: Db, schichtId: number, baseUrl: string): Promise<{ titel: string; text: string }> {
  const s = await ladeSchicht(db, schichtId);
  const vorlage = await ladeVorlage(db, CLUBDESK_TERMIN);
  const werte = await bausteinwerte(db, s, baseUrl);
  return {
    titel: fuelleClubdeskVorlage(vorlage.betreff, werte).replace(/\s*\n\s*/g, ' ') || werte.titel,
    text: fuelleClubdeskVorlage(vorlage.text, werte),
  };
}
