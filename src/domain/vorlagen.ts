// Vorlagen, die ein Admin in den Einstellungen bearbeitet (Wunsch Yann 19.11.2026).
// «Änderung melden» an die Informatik (14.4) und der Text für den Clubdesk-Termin (20.11.2026).
// Platzhalter in geschweiften Klammern, z. B. {name}. Ohne Zeile in der Tabelle gilt die Standardvorlage.
import { eine, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, Konflikt } from './eingabe.js';
import { isoUtc } from './zeit.js';

export interface Vorlage {
  betreff: string;
  text: string;
  /** 0 = Standardvorlage, noch nie gespeichert. */
  version: number;
}

export const AENDERUNG_MELDEN = 'aenderung_melden';

export const STANDARD_AENDERUNG: Omit<Vorlage, 'version'> = {
  betreff: 'Änderung Personendaten: {name} (Clubdesk-ID {clubdesk_id})',
  text: [
    'Hallo Informatik',
    '',
    'Bitte ändert in Clubdesk folgende Angaben:',
    '',
    'Clubdesk-ID: {clubdesk_id}',
    'Name: {name}',
    '',
    'Was ändern: ',
    'Alt: ',
    'Neu: ',
    '',
    'Weitere Änderungen: ',
    '',
    'Bemerkung: ',
    '',
    'Danke',
  ].join('\n'),
};

export const CLUBDESK_TERMIN = 'clubdesk_termin';

/** Standard für den Clubdesk-Termin. «betreff» ist der Titel. Bausteine: siehe clubdesk-text.ts. */
export const STANDARD_CLUBDESK: Omit<Vorlage, 'version'> = {
  betreff: '{titel}',
  text: [
    'Einsatz: {einsatz}',
    'Schicht: {schicht}',
    'Zeit: {zeit}',
    'Ort: {ort}',
    'Abtreten: {abtreten}',
    'Tenue: {tenue}',
    'Mindestalter: {mindestalter}',
    'Bemerkung: {bemerkung}',
    '{einsatz_bemerkung}',
  ].join('\n'),
};

/** Platzhalter mit Erklärung für die Einstellungsseite. */
export const PLATZHALTER: Record<string, string> = {
  '{clubdesk_id}': 'Clubdesk-ID',
  '{name}': 'Vorname und Nachname',
  '{vorname}': 'Vorname',
  '{nachname}': 'Nachname',
  '{rang}': 'Rang',
};

/** Ein mailto-Link wird zu lang für manche Mailprogramme. Darum ist der Text begrenzt. */
export const MAX_TEXT = 1500;
export const MAX_BETREFF = 200;
/** Der Clubdesk-Text geht nicht über einen mailto-Link. Darum ist er länger erlaubt. */
export const MAX_TEXT_CLUBDESK = 4000;

interface Art {
  standard: Omit<Vorlage, 'version'>;
  maxText: number;
  feldBetreff: string;
}

const ARTEN: Record<string, Art> = {
  [AENDERUNG_MELDEN]: { standard: STANDARD_AENDERUNG, maxText: MAX_TEXT, feldBetreff: 'Der Betreff' },
  [CLUBDESK_TERMIN]: { standard: STANDARD_CLUBDESK, maxText: MAX_TEXT_CLUBDESK, feldBetreff: 'Der Titel' },
};

function art(schluessel: string): Art {
  const a = ARTEN[schluessel];
  if (!a) throw new Eingabefehler('Unbekannte Vorlage.');
  return a;
}

export function istVorlage(schluessel: unknown): schluessel is string {
  return typeof schluessel === 'string' && schluessel in ARTEN;
}

export async function ladeVorlage(db: Db, schluessel = AENDERUNG_MELDEN): Promise<Vorlage> {
  const z = await eine<Vorlage>(db, 'SELECT betreff, text, version FROM vorlage WHERE schluessel = ?', [schluessel]);
  return z ? { betreff: z.betreff, text: z.text, version: Number(z.version) } : { ...art(schluessel).standard, version: 0 };
}

/** Setzt die Werte ein. Unbekannte Platzhalter bleiben stehen. */
export function fuelleVorlage(vorlage: string, werte: Record<string, string | number | null | undefined>): string {
  return vorlage.replace(/\{([a-z_]+)\}/g, (ganz, name: string) => (name in werte ? String(werte[name] ?? '') : ganz));
}

function pruefe(betreffRoh: unknown, textRoh: unknown, a: Art): { betreff: string; text: string } {
  const betreff = typeof betreffRoh === 'string' ? betreffRoh.trim() : '';
  const text = typeof textRoh === 'string' ? textRoh.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : '';
  if (!betreff) throw new Eingabefehler(`${a.feldBetreff} fehlt.`);
  if (/[\r\n]/.test(betreff)) throw new Eingabefehler(`${a.feldBetreff} darf keinen Zeilenumbruch enthalten.`);
  if (betreff.length > MAX_BETREFF) throw new Eingabefehler(`${a.feldBetreff} ist zu lang (höchstens ${MAX_BETREFF} Zeichen).`);
  if (!text.trim()) throw new Eingabefehler('Der Text fehlt.');
  if (text.length > a.maxText) throw new Eingabefehler(`Der Text ist zu lang (höchstens ${a.maxText} Zeichen).`);
  return { betreff, text };
}

/**
 * Speichert die Vorlage. Ein Formular mit alter Version speichert nichts (Konflikt).
 * standard = true stellt die Standardvorlage wieder her. Das Protokoll hält alten und neuen Text fest.
 */
export async function speichereVorlage(
  db: Db,
  eingaben: { betreff?: unknown; text?: unknown; version?: unknown; standard?: boolean },
  benutzerId: number | null,
  schluessel = AENDERUNG_MELDEN,
): Promise<boolean> {
  const a = art(schluessel);
  const neu = eingaben.standard ? { ...a.standard } : pruefe(eingaben.betreff, eingaben.text, a);
  return transaktion(db, async (c) => {
    const alt = await eine<Vorlage>(c, 'SELECT betreff, text, version FROM vorlage WHERE schluessel = ? FOR UPDATE', [schluessel]);
    const altVersion = alt ? Number(alt.version) : 0;
    const v = eingaben.version;
    if (!eingaben.standard && v !== undefined && v !== null && v !== '' && Number(v) !== altVersion) {
      throw new Konflikt('Jemand hat die Vorlage inzwischen geändert. Prüfe den Text. Ein zweites Speichern überschreibt den neuen Stand.', altVersion);
    }
    const vorher = alt ?? a.standard;
    if (vorher.betreff === neu.betreff && vorher.text === neu.text) return false;
    const jetzt = isoUtc(new Date());
    await c.query(
      `INSERT INTO vorlage (schluessel, betreff, text, version, geaendert_am, geaendert_von) VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE betreff = VALUES(betreff), text = VALUES(text), version = version + 1,
         geaendert_am = VALUES(geaendert_am), geaendert_von = VALUES(geaendert_von)`,
      [schluessel, neu.betreff, neu.text, jetzt, benutzerId],
    );
    await c.query('INSERT INTO konfiguration_protokoll (zeit, benutzer_id, schluessel, alt, neu) VALUES (?, ?, ?, ?, ?)', [
      jetzt, benutzerId, `Vorlage ${schluessel}`, `${vorher.betreff}\n\n${vorher.text}`, `${neu.betreff}\n\n${neu.text}`,
    ]);
    return true;
  });
}
