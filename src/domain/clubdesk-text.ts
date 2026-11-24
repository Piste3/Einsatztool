// Text für den Clubdesk-Termin (Wunsch Yann 20.11.2026).
// Der Admin pflegt Titel und Text in Admin › Einstellungen. Bausteine in geschweiften Klammern,
// z. B. {ort}, füllt das Tool je Schicht aus. Ohne gespeicherte Vorlage gilt die Standardvorlage.
// Regel: Eine Zeile mit Bausteinen, die alle leer sind, entfällt (wie «Leere Felder entfallen», 17.1).
// Ausnahme (Wunsch Yann 24.11.2026): Die Zeile mit der Einsatzleitung bleibt immer, der Wert ist dann leer.
import { alle, type Db } from '../db/db.js';
import { ladeSchicht, type SchichtMitEinsatz } from './schicht.js';
import { terminTitel } from './ics.js';
import { ladeVorlage, CLUBDESK_TERMIN } from './vorlagen.js';
import { datumChVonIso, lokaleZeit, wochentag, wochentagKurz, zeitraumText } from './zeit.js';
import { alsHtml, alsText } from './textformat.js';

/** Angaben, die nicht aus der Schicht kommen. */
export interface ClubdeskOptionen {
  baseUrl: string;
  /** Aufgebotsadresse (MAIL_FROM). */
  aufgebotMail: string;
  /** Angemeldeter Benutzer. Rang und Name kommen aus den Personen mit gleicher Mail oder gleichem Namen. */
  benutzer?: { name: string; email: string } | null;
}

/** Bausteine mit Erklärung für die Einstellungsseite. Die Reihenfolge ist die Reihenfolge der Liste. */
export const BAUSTEINE: Record<string, string> = {
  '{titel}': 'Titel: Einsatz, bei mehreren Schichten «Einsatz – Schicht»',
  '{einsatz}': 'Name des Einsatzes',
  '{schicht}': 'Name der Schicht',
  '{wochentag}': 'Wochentag, z. B. Samstag',
  '{datum}': 'Datum, z. B. 21.11.2026',
  '{beginn}': 'Beginn, z. B. 12:30 (leer bei «Zeit offen»)',
  '{ende}': 'Ende, z. B. 23:00 (leer bei «Zeit offen»)',
  '{ende_wochentag}': 'Wochentag des Endes (bei Schichten über Mitternacht anders)',
  '{ende_datum}': 'Datum des Endes',
  '{antreten_text}': 'Antreten ganz, z. B. Samstag, 21.11.2026 12:30, Kunstmuseum Basel',
  '{abtreten_text}': 'Abtreten ganz, z. B. Samstag, 21.11.2026 23:00, Kunstmuseum Basel',
  '{zeit}': 'Datum und Zeit, z. B. Sa 21.11.2026, 12:30–23:00',
  '{ort}': 'Ort (Antreten)',
  '{abtreten}': 'Ort Abtreten',
  '{tenue}': 'Tenue',
  '{hinweis}': 'Hinweis Aufgebot',
  '{mindestalter}': 'Mindestalter',
  '{mindestrang}': 'Mindestrang',
  '{bemerkung}': 'Bemerkung extern der Schicht',
  '{einsatz_bemerkung}': 'Bemerkung extern des Einsatzes',
  '{einsatzleitung}': 'Einsatzleitung (angemeldet oder bestätigt), Rang und Name',
  '{einsatzleitung_telefon}': 'Einsatzleitung mit Telefon, z. B. Hptm Quirin Plösser (079 645 66 76)',
  '{aufgebot_mail}': 'Aufgebotsadresse, z. B. aufgebot@kkb.ch',
  '{absender}': 'Du: Rang und Name des angemeldeten Benutzers',
  '{schichten}': 'Alle Schichten des Einsatzes, eine Zeile je Schicht',
  '{formular}': 'Link zum Anmeldeformular',
};

export type Bausteinwerte = Record<string, string>;

/** Bausteine, deren Zeile auch ohne Wert stehen bleibt (Wunsch Yann 24.11.2026). */
const IMMER_ZEIGEN = new Set(['einsatzleitung', 'einsatzleitung_telefon']);

/**
 * Setzt die Werte ein. Eine Zeile mit mindestens einem Baustein, deren Bausteine alle leer sind, entfällt.
 * Ausnahme: Eine Zeile mit einem Baustein aus IMMER_ZEIGEN bleibt stehen.
 * Unbekannte Bausteine bleiben stehen. Mehr als eine Leerzeile hintereinander wird zu einer.
 */
export function fuelleClubdeskVorlage(vorlage: string, werte: Bausteinwerte): string {
  const zeilen: string[] = [];
  for (const zeile of vorlage.replace(/\r\n?/g, '\n').split('\n')) {
    const namen = [...zeile.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((n) => n in werte);
    if (namen.length > 0 && namen.every((n) => !werte[n]) && !namen.some((n) => IMMER_ZEIGEN.has(n))) continue;
    // In einer Tabellenzeile wird ein Zeilenumbruch im Wert zu \\ (neue Zeile in der Zelle).
    const tabelle = /^\s*\|/.test(zeile);
    zeilen.push(zeile.replace(/\{([a-z_]+)\}/g, (ganz, n: string) => (n in werte ? (tabelle ? werte[n].replace(/\n/g, ' \\\\ ') : werte[n]) : ganz)));
  }
  return zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Datum und Zeit einer Schicht als Text. Bei «Zeit offen» ohne Uhrzeit. */
function zeitText(s: { start_zeit: string; end_zeit: string; zeit_offen?: number }): string {
  if (Number(s.zeit_offen)) return `${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit)}, Zeit offen`;
  return zeitraumText(s.start_zeit, s.end_zeit);
}

/** Werte aller Bausteine für eine Schicht. */
export async function bausteinwerte(db: Db, s: SchichtMitEinsatz, o: ClubdeskOptionen): Promise<Bausteinwerte> {
  const schichten = await alle<{ name: string; start_zeit: string; end_zeit: string; zeit_offen: number }>(
    db,
    'SELECT name, start_zeit, end_zeit, zeit_offen FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit, position, id',
    [s.einsatz_id],
  );
  // Einsatzleitung wie im Aufgebot (Regel 20.3): Rolle «Einsatzleitung», hier angemeldet oder bestätigt.
  const el = await alle<{ person_id: number | null; name_text: string | null; vorname: string | null; nachname: string | null; rang: string | null; telefon: string | null; telefon_privat: string | null }>(
    db,
    `SELECT a.person_id, a.name_text, p.vorname, p.nachname, r.name AS rang, p.telefon, p.telefon_privat
       FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
      WHERE a.schicht_id = ? AND a.rolle = 'Einsatzleitung' AND a.status IN ('angemeldet', 'bestaetigt') AND p.geloescht_am IS NULL
      ORDER BY (r.reihenfolge IS NULL), r.reihenfolge DESC, p.nachname, p.vorname, a.name_text`,
    [s.id],
  );
  const offen = Number(s.zeit_offen) === 1;
  const elName = (e: (typeof el)[number]) => (e.person_id ? [e.rang, e.vorname, e.nachname].filter(Boolean).join(' ') : (e.name_text ?? ''));
  const langZeit = (iso: string) => `${wochentag(iso)}, ${datumChVonIso(iso)}${offen ? ', Zeit offen' : ` ${lokaleZeit(iso)}`}`;
  return {
    titel: terminTitel(s),
    einsatz: s.einsatz_name,
    schicht: s.name,
    wochentag: wochentag(s.start_zeit),
    datum: datumChVonIso(s.start_zeit),
    beginn: offen ? '' : lokaleZeit(s.start_zeit),
    ende: offen ? '' : lokaleZeit(s.end_zeit),
    ende_wochentag: wochentag(s.end_zeit),
    ende_datum: datumChVonIso(s.end_zeit),
    antreten_text: [langZeit(s.start_zeit), s.ort].filter(Boolean).join(', '),
    abtreten_text: offen ? (s.abtreten_ort ?? '') : [langZeit(s.end_zeit), s.abtreten_ort].filter(Boolean).join(', '),
    zeit: zeitText(s),
    ort: s.ort ?? '',
    abtreten: s.abtreten_ort ?? '',
    tenue: s.tenue ?? '',
    hinweis: s.aufgebot_hinweis ?? '',
    mindestalter: s.min_alter !== null && s.min_alter !== undefined ? String(s.min_alter) : '',
    mindestrang: s.min_rang_name ?? '',
    bemerkung: s.bemerkung_extern ?? '',
    einsatz_bemerkung: s.einsatz_bemerkung_extern ?? '',
    einsatzleitung: el.map(elName).filter(Boolean).join(', '),
    einsatzleitung_telefon: el
      .map((e) => {
        const tel = e.telefon || e.telefon_privat;
        return elName(e) && tel ? `${elName(e)} (${tel})` : elName(e);
      })
      .filter(Boolean)
      .join(', '),
    aufgebot_mail: o.aufgebotMail,
    absender: await absender(db, o.benutzer),
    schichten: schichten.map((x) => `${x.name}: ${zeitText(x)}`).join('\n'),
    formular: `${o.baseUrl}/anmeldung`,
  };
}

/** Rang und Name des Benutzers. Gesucht über die Mail, sonst über den Namen. Ohne Treffer der Name aus dem Login. */
async function absender(db: Db, b: ClubdeskOptionen['benutzer']): Promise<string> {
  if (!b) return '';
  const p = await alle<{ vorname: string | null; nachname: string | null; rang: string | null }>(
    db,
    `SELECT p.vorname, p.nachname, r.name AS rang FROM person p LEFT JOIN rang r ON r.id = p.rang_id
      WHERE p.geloescht_am IS NULL AND (LOWER(p.email) = LOWER(?) OR CONCAT(p.vorname, ' ', p.nachname) = ?)
      ORDER BY LOWER(p.email) = LOWER(?) DESC LIMIT 1`,
    [b.email, b.name, b.email],
  );
  return p.length ? [p[0].rang, p[0].vorname, p[0].nachname].filter(Boolean).join(' ') : b.name;
}

/** Fertiger Titel, reiner Text und HTML für den Clubdesk-Termin einer Schicht. */
export async function clubdeskText(db: Db, schichtId: number, o: ClubdeskOptionen): Promise<{ titel: string; text: string; html: string }> {
  const s = await ladeSchicht(db, schichtId);
  const vorlage = await ladeVorlage(db, CLUBDESK_TERMIN);
  const werte = await bausteinwerte(db, s, o);
  const roh = fuelleClubdeskVorlage(vorlage.text, werte);
  return {
    titel: alsText(fuelleClubdeskVorlage(vorlage.betreff, werte)).replace(/\s*\n\s*/g, ' ') || werte.titel,
    text: alsText(roh),
    html: alsHtml(roh),
  };
}
