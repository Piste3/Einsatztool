// Konfiguration über die Admin-Seite (Entscheid Yann 19.11.2026).
// Die Datei ENV_FILE (einsatzplaner.env) bleibt die einzige Quelle. Die Seite liest und schreibt diese Datei.
// So kann ein Admin bei einem falschen Wert die Datei auf dem Server von Hand korrigieren.
// Änderungen wirken nach einem Neustart. Geheimnisse gehen nie an den Browser zurück.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { leseEnvDatei } from '../config.js';
import { alle, transaktion, type Db } from '../db/db.js';
import { Eingabefehler } from './eingabe.js';
import { isoUtc } from './zeit.js';

export type Art = 'text' | 'port' | 'stunde' | 'url' | 'urls' | 'mail' | 'geheim' | 'janein' | 'pfad' | 'host' | 'branch' | 'name';

export interface Definition {
  schluessel: string;
  gruppe: string;
  titel: string;
  hilfe: string;
  art: Art;
  standard: string;
  pflicht?: boolean;
  /** Warnung: Ein falscher Wert sperrt den Zugang zum Tool. */
  heikel?: boolean;
}

export const GRUPPEN = ['Server', 'Datenbank', 'Ordner', 'Login mit Microsoft Entra', 'Mail', 'Clubdesk', 'Tagesexport und SharePoint', 'Update'] as const;

export const DEFINITIONEN: Definition[] = [
  { schluessel: 'PORT', gruppe: 'Server', titel: 'Port', hilfe: 'Port des Servers. Der Reverse-Proxy muss denselben Port nutzen.', art: 'port', standard: '3010', pflicht: true, heikel: true },
  { schluessel: 'LISTEN_HOST', gruppe: 'Server', titel: 'Adresse des Servers', hilfe: '127.0.0.1 = nur dieser Rechner. Setze die interne Adresse, wenn der Reverse-Proxy auf einem anderen Rechner läuft.', art: 'host', standard: '127.0.0.1', pflicht: true, heikel: true },
  { schluessel: 'BASE_URL', gruppe: 'Server', titel: 'Öffentliche Adresse', hilfe: 'Adresse hinter dem Reverse-Proxy, z. B. https://einsatzplaner.kkb.ch. Der Login braucht genau diese Adresse.', art: 'url', standard: 'http://localhost:3010', pflicht: true, heikel: true },
  { schluessel: 'SESSION_SECRET', gruppe: 'Server', titel: 'Sitzungsschlüssel', hilfe: 'Zufälliger Schlüssel, mindestens 32 Zeichen. Ein neuer Schlüssel meldet alle Benutzer ab.', art: 'geheim', standard: '', pflicht: true },

  { schluessel: 'DB_HOST', gruppe: 'Datenbank', titel: 'Datenbank-Server', hilfe: 'Meist 127.0.0.1.', art: 'host', standard: '127.0.0.1', pflicht: true, heikel: true },
  { schluessel: 'DB_PORT', gruppe: 'Datenbank', titel: 'Datenbank-Port', hilfe: 'Meist 3306.', art: 'port', standard: '3306', pflicht: true, heikel: true },
  { schluessel: 'DB_NAME', gruppe: 'Datenbank', titel: 'Name der Datenbank', hilfe: '', art: 'name', standard: 'einsatzplaner', pflicht: true, heikel: true },
  { schluessel: 'DB_USER', gruppe: 'Datenbank', titel: 'Datenbank-Benutzer', hilfe: '', art: 'name', standard: 'einsatzplaner', pflicht: true, heikel: true },
  { schluessel: 'DB_PASSWORD', gruppe: 'Datenbank', titel: 'Datenbank-Passwort', hilfe: '', art: 'geheim', standard: '', heikel: true },

  { schluessel: 'DATA_DIR', gruppe: 'Ordner', titel: 'Datenordner', hilfe: 'Daten und Import-Dateien, z. B. C:\\einsatzplaner\\data.', art: 'pfad', standard: 'data', pflicht: true },
  { schluessel: 'EXPORT_DIR', gruppe: 'Ordner', titel: 'Exportordner', hilfe: 'Tagesexport und Sicherungen, z. B. C:\\einsatzplaner\\export.', art: 'pfad', standard: 'export', pflicht: true },

  { schluessel: 'ENTRA_TENANT_ID', gruppe: 'Login mit Microsoft Entra', titel: 'Mandanten-ID (Tenant ID)', hilfe: 'Aus dem Entra Admin Center, App-Registrierung › Übersicht.', art: 'text', standard: '', heikel: true },
  { schluessel: 'ENTRA_CLIENT_ID', gruppe: 'Login mit Microsoft Entra', titel: 'Anwendungs-ID (Client ID)', hilfe: 'Aus dem Entra Admin Center, App-Registrierung › Übersicht.', art: 'text', standard: '', heikel: true },
  { schluessel: 'ENTRA_CLIENT_SECRET', gruppe: 'Login mit Microsoft Entra', titel: 'Geheimer Clientschlüssel', hilfe: 'Aus dem Entra Admin Center, App-Registrierung › Zertifikate und Geheimnisse. Den Wert, nicht die ID.', art: 'geheim', standard: '', heikel: true },

  { schluessel: 'SMTP_HOST', gruppe: 'Mail', titel: 'SMTP-Server', hilfe: 'Für Exchange Online: smtp.office365.com. Leer = keine Mails.', art: 'text', standard: '' },
  { schluessel: 'SMTP_PORT', gruppe: 'Mail', titel: 'SMTP-Port', hilfe: '587 (STARTTLS) oder 465 (TLS).', art: 'port', standard: '587', pflicht: true },
  { schluessel: 'SMTP_USER', gruppe: 'Mail', titel: 'SMTP-Benutzer', hilfe: '', art: 'text', standard: '' },
  { schluessel: 'SMTP_PASS', gruppe: 'Mail', titel: 'SMTP-Passwort', hilfe: '', art: 'geheim', standard: '' },
  { schluessel: 'MAIL_FROM', gruppe: 'Mail', titel: 'Aufgebotsadresse', hilfe: 'Absender und Reply-To aller Mails.', art: 'mail', standard: 'aufgebot@kkb.ch', pflicht: true },
  { schluessel: 'MAIL_INFORMATIK', gruppe: 'Mail', titel: 'Adresse der Informatik', hilfe: 'Empfänger von «Änderung melden» auf der Personenseite. Die Informatik pflegt die Personendaten in Clubdesk.', art: 'mail', standard: '' },
  { schluessel: 'BESTAETIGUNG_STUNDE', gruppe: 'Mail', titel: 'Stunde der Bestätigungsmail', hilfe: 'Lokale Zeit, 0 bis 23.', art: 'stunde', standard: '18', pflicht: true },

  { schluessel: 'CLUBDESK_ICAL_URL', gruppe: 'Clubdesk', titel: 'Adresse des iCal-Feeds', hilfe: 'Aus Clubdesk › Kalender › Abonnieren.', art: 'url', standard: '' },
  { schluessel: 'FORM_ALLOWED_ORIGIN', gruppe: 'Clubdesk', titel: 'Seite mit dem Anmeldeformular', hilfe: 'Nur diese Websites dürfen das Formular im iframe einbetten, z. B. https://web.kkb.ch. Mehrere mit Leerzeichen trennen. Ein Pfad zählt nicht.', art: 'urls', standard: '' },

  { schluessel: 'EXPORT_HOUR', gruppe: 'Tagesexport und SharePoint', titel: 'Stunde des Tagesexports', hilfe: 'Lokale Zeit, 0 bis 23.', art: 'stunde', standard: '2', pflicht: true },
  { schluessel: 'SHAREPOINT_SITE_ID', gruppe: 'Tagesexport und SharePoint', titel: 'SharePoint Site-ID', hilfe: 'Leer = kein Hochladen nach SharePoint.', art: 'text', standard: '' },
  { schluessel: 'SHAREPOINT_DRIVE_ID', gruppe: 'Tagesexport und SharePoint', titel: 'SharePoint Drive-ID', hilfe: '', art: 'text', standard: '' },
  { schluessel: 'SHAREPOINT_ORDNER', gruppe: 'Tagesexport und SharePoint', titel: 'Ordner auf SharePoint', hilfe: '', art: 'text', standard: 'Einsatzplaner' },

  { schluessel: 'UPDATE_ERLAUBT', gruppe: 'Update', titel: 'Update über Admin › Update erlaubt', hilfe: '', art: 'janein', standard: '0', pflicht: true },
  { schluessel: 'UPDATE_BRANCH', gruppe: 'Update', titel: 'Branch für das Update', hilfe: 'Meist main.', art: 'branch', standard: 'main', pflicht: true },
];

const PER_SCHLUESSEL = new Map(DEFINITIONEN.map((d) => [d.schluessel, d]));

/** Alte Namen von Schlüsseln. Das Tool liest sie weiter und schreibt beim Speichern den neuen Namen. */
export const ALTE_NAMEN: Record<string, string> = { MAIL_ROMAN: 'MAIL_INFORMATIK' };

/** Übernimmt Werte unter alten Namen, wenn der neue Name fehlt. */
function mitNeuenNamen<T extends Record<string, string | undefined>>(werte: T): T {
  const r: Record<string, string | undefined> = { ...werte };
  for (const [alt, neu] of Object.entries(ALTE_NAMEN)) {
    if (r[neu] === undefined && r[alt] !== undefined) r[neu] = r[alt];
  }
  return r as T;
}

/** Woher die Seite liest und was beim Start galt. */
export interface Quelle {
  /** Pfad der Datei einsatzplaner.env. */
  pfad: string;
  /** Schlüssel aus echten Umgebungsvariablen. Sie haben Vorrang. Die Seite kann sie nicht ändern. */
  umgebung: Set<string>;
  /** Werte beim Start des Servers. Ein Unterschied heisst: Neustart nötig. */
  laufend: Record<string, string>;
}

export function erstelleQuelle(pfad: string, env: NodeJS.ProcessEnv, umgebung: Set<string>): Quelle {
  const laufend: Record<string, string> = {};
  const e = mitNeuenNamen(env);
  for (const d of DEFINITIONEN) laufend[d.schluessel] = e[d.schluessel] ?? '';
  const u = new Set([...umgebung].map((k) => ALTE_NAMEN[k] ?? k).filter((k) => PER_SCHLUESSEL.has(k)));
  return { pfad, umgebung: u, laufend };
}

export interface Stand {
  text: string;
  werte: Record<string, string>;
  /** Prüfsumme des Dateiinhalts. Ein anderer Wert heisst: Jemand hat die Datei inzwischen geändert. */
  version: string;
}

export function versionVon(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function leseStand(pfad: string): Stand {
  const text = existsSync(pfad) ? readFileSync(pfad, 'utf8') : '';
  return { text, werte: mitNeuenNamen(leseEnvDatei(text)), version: versionVon(text) };
}

/** Schreibt einen Wert so, dass leseEnvDatei genau diesen Wert zurückliest. */
export function formatiereWert(w: string): string {
  if (w !== w.trim() || /^["']/.test(w) || /["']$/.test(w)) return `"${w}"`;
  return w;
}

/**
 * Setzt Werte in den Text der Datei. Kommentare und Reihenfolge bleiben.
 * Fehlende Schlüssel kommen ans Ende. Zeilenenden (CRLF oder LF) bleiben.
 */
export function setzeInEnvText(text: string, werte: Record<string, string>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const zeilen = text.length ? text.split(/\r?\n/) : [];
  const endeLeer = zeilen.length > 0 && zeilen[zeilen.length - 1] === '';
  if (endeLeer) zeilen.pop();
  const erledigt = new Set<string>();
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i].trim();
    if (!z || z.startsWith('#')) continue;
    const gleich = z.indexOf('=');
    if (gleich < 1) continue;
    const roh = z.slice(0, gleich).trim();
    // Ein alter Name erhält den neuen Namen.
    const k = ALTE_NAMEN[roh] && ALTE_NAMEN[roh] in werte ? ALTE_NAMEN[roh] : roh;
    if (!(k in werte)) continue;
    zeilen[i] = `${k}=${formatiereWert(werte[k])}`;
    erledigt.add(k);
  }
  const neu = Object.keys(werte).filter((k) => !erledigt.has(k));
  if (neu.length) {
    if (zeilen.length && zeilen[zeilen.length - 1].trim() !== '') zeilen.push('');
    zeilen.push('# Ergänzt über Admin › Konfiguration');
    for (const k of neu) zeilen.push(`${k}=${formatiereWert(werte[k])}`);
  }
  return zeilen.join(eol) + eol;
}

/** Prüft einen Wert aus dem Formular. Gibt den bereinigten Wert zurück. */
export function pruefeWert(d: Definition, roh: unknown): string {
  const w = typeof roh === 'string' ? roh.trim() : '';
  const feld = `«${d.titel}»`;
  if (/[\r\n\0]/.test(w)) throw new Eingabefehler(`${feld} darf keinen Zeilenumbruch enthalten.`);
  if (w.length > 1000) throw new Eingabefehler(`${feld} ist zu lang (höchstens 1000 Zeichen).`);
  if (!w) {
    if (d.pflicht) throw new Eingabefehler(`${feld} fehlt.`);
    return '';
  }
  switch (d.art) {
    case 'port':
      if (!/^\d{1,5}$/.test(w) || Number(w) < 1 || Number(w) > 65535) throw new Eingabefehler(`${feld} muss eine Zahl von 1 bis 65535 sein.`);
      return String(Number(w));
    case 'stunde':
      if (!/^\d{1,2}$/.test(w) || Number(w) > 23) throw new Eingabefehler(`${feld} muss eine Zahl von 0 bis 23 sein.`);
      return String(Number(w));
    case 'url': {
      let u: URL;
      try {
        u = new URL(w);
      } catch {
        throw new Eingabefehler(`${feld} ist keine gültige Adresse.`);
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Eingabefehler(`${feld} muss mit https:// oder http:// beginnen.`);
      return w.replace(/\/+$/, '');
    }
    case 'urls': {
      const teile = w.split(/[\s,]+/).filter(Boolean);
      for (const t of teile) {
        let u: URL;
        try {
          u = new URL(t);
        } catch {
          throw new Eingabefehler(`${feld}: «${t}» ist keine gültige Adresse.`);
        }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Eingabefehler(`${feld} muss mit https:// oder http:// beginnen.`);
      }
      return teile.join(' ');
    }
    case 'mail':
      if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(w)) throw new Eingabefehler(`${feld} ist keine gültige Mail-Adresse.`);
      return w;
    case 'host':
      if (!/^[A-Za-z0-9.:\-\[\]]+$/.test(w)) throw new Eingabefehler(`${feld} enthält unerlaubte Zeichen.`);
      return w;
    case 'name':
      if (!/^[A-Za-z0-9_.\-$@]+$/.test(w)) throw new Eingabefehler(`${feld} enthält unerlaubte Zeichen.`);
      return w;
    case 'branch':
      if (!/^[A-Za-z0-9._\/-]+$/.test(w) || w.includes('..') || w.startsWith('-')) throw new Eingabefehler(`${feld} enthält unerlaubte Zeichen.`);
      return w;
    case 'janein':
      if (w !== '0' && w !== '1') throw new Eingabefehler(`${feld}: Wähle ja oder nein.`);
      return w;
    case 'geheim':
      if (d.schluessel === 'SESSION_SECRET' && w.length < 32) throw new Eingabefehler(`${feld} muss mindestens 32 Zeichen haben.`);
      return w;
    default:
      return w;
  }
}

/** Eine Zeile der Seite. Geheimnisse haben keinen Wert, nur «gesetzt». */
export interface Zeile {
  d: Definition;
  /** Wert aus der Datei. Bei Geheimnissen immer leer. */
  wert: string;
  gesetzt: boolean;
  /** Echte Umgebungsvariable: Die Seite kann den Wert nicht ändern. */
  gesperrt: boolean;
  /** Der Wert in der Datei unterscheidet sich vom Wert beim Start. */
  neustartNoetig: boolean;
}

function wertInDatei(stand: Stand, d: Definition): string {
  return stand.werte[d.schluessel] ?? d.standard;
}

export function zeilen(q: Quelle): { version: string; zeilen: Zeile[] } {
  const stand = leseStand(q.pfad);
  return {
    version: stand.version,
    zeilen: DEFINITIONEN.map((d) => {
      const gesperrt = q.umgebung.has(d.schluessel);
      const datei = wertInDatei(stand, d);
      const laufend = q.laufend[d.schluessel] || d.standard;
      const dateiWirksam = datei || d.standard;
      return {
        d,
        wert: d.art === 'geheim' ? '' : gesperrt ? q.laufend[d.schluessel] ?? '' : datei,
        gesetzt: gesperrt ? !!q.laufend[d.schluessel] : !!datei,
        gesperrt,
        neustartNoetig: !gesperrt && dateiWirksam !== laufend,
      };
    }),
  };
}

/** Werte, die nach einem Neustart gelten: Umgebungsvariable vor Datei vor Standard. */
export function kuenftigeWerte(q: Quelle): Record<string, string> {
  const stand = leseStand(q.pfad);
  const r: Record<string, string> = {};
  for (const d of DEFINITIONEN) r[d.schluessel] = q.umgebung.has(d.schluessel) ? q.laufend[d.schluessel] ?? '' : wertInDatei(stand, d);
  return r;
}

export interface Aenderung {
  schluessel: string;
  alt: string;
  neu: string;
}

export class KonfigKonflikt extends Eingabefehler {
  constructor(readonly aktuelleVersion: string) {
    super('Jemand hat die Konfiguration inzwischen geändert. Prüfe die Werte. Ein zweites Speichern überschreibt den neuen Stand.');
    this.name = 'KonfigKonflikt';
  }
}

/** Die Datenbank ist mit den neuen Werten nicht erreichbar. Das Tool speichert nur nach Bestätigung. */
export class DatenbankNichtErreichbar extends Eingabefehler {
  constructor(meldung: string) {
    super(`Mit den neuen Werten ist die Datenbank nicht erreichbar: ${meldung}`);
    this.name = 'DatenbankNichtErreichbar';
  }
}

/** Liest die Eingaben des Formulars. Felder heissen w_<SCHLÜSSEL>. Leeres Geheimnis = unverändert. */
export function berechneAenderungen(stand: Stand, q: Quelle, eingaben: Record<string, unknown>): { werte: Record<string, string>; aenderungen: Aenderung[] } {
  const werte: Record<string, string> = {};
  const aenderungen: Aenderung[] = [];
  for (const d of DEFINITIONEN) {
    if (q.umgebung.has(d.schluessel)) continue;
    const feld = `w_${d.schluessel}`;
    const alt = stand.werte[d.schluessel];
    let neu: string;
    if (d.art === 'geheim') {
      if (d.schluessel === 'SESSION_SECRET' && eingaben[`erzeugen_${d.schluessel}`] === '1') {
        neu = randomBytes(32).toString('base64url');
      } else if (eingaben[`leeren_${d.schluessel}`] === '1') {
        if (d.pflicht) throw new Eingabefehler(`«${d.titel}» darf nicht leer sein.`);
        neu = '';
      } else if (typeof eingaben[feld] === 'string' && (eingaben[feld] as string).trim() !== '') {
        neu = pruefeWert(d, eingaben[feld]);
      } else {
        continue;
      }
    } else {
      if (!(feld in eingaben)) continue;
      neu = pruefeWert(d, eingaben[feld]);
    }
    // Ein fehlender Eintrag mit Standardwert ist keine Änderung.
    if ((alt ?? d.standard) === neu || (alt || d.standard) === (neu || d.standard)) continue;
    werte[d.schluessel] = neu;
    aenderungen.push({ schluessel: d.schluessel, alt: alt ?? '', neu });
  }
  return { werte, aenderungen };
}

/** Text fürs Protokoll. Geheimnisse erscheinen nie im Klartext. */
function protokollWert(schluessel: string, w: string): string {
  if (PER_SCHLUESSEL.get(schluessel)?.art === 'geheim') return w ? '(gesetzt)' : '(leer)';
  return w.slice(0, 1000);
}

let sperre: Promise<unknown> = Promise.resolve();

/** Nur ein Speichervorgang gleichzeitig (ein Server-Prozess). */
function nacheinander<T>(fn: () => Promise<T>): Promise<T> {
  const lauf = sperre.then(fn, fn);
  sperre = lauf.catch(() => undefined);
  return lauf;
}

export interface SpeicherOptionen {
  /** Prüft die Verbindung zur Datenbank mit neuen Werten. Wirft bei einem Fehler. */
  testeDatenbank?: (w: { host: string; port: number; name: string; user: string; password: string }) => Promise<void>;
  /** Speichern, auch wenn die Datenbank nicht erreichbar ist. */
  trotzdem?: boolean;
}

/**
 * Speichert die Eingaben in der Datei und schreibt das Protokoll.
 * Die Datei entsteht neu (temporäre Datei, dann umbenennen). Der alte Stand bleibt als «.vorher».
 */
export async function speichereKonfiguration(
  db: Db,
  q: Quelle,
  eingaben: Record<string, unknown>,
  benutzerId: number | null,
  optionen: SpeicherOptionen = {},
): Promise<Aenderung[]> {
  return nacheinander(async () => {
    const stand = leseStand(q.pfad);
    const version = typeof eingaben.version === 'string' ? eingaben.version : '';
    if (version && version !== stand.version) throw new KonfigKonflikt(stand.version);
    const { werte, aenderungen } = berechneAenderungen(stand, q, eingaben);
    if (!aenderungen.length) return [];

    if (optionen.testeDatenbank && !optionen.trotzdem && aenderungen.some((a) => a.schluessel.startsWith('DB_'))) {
      const w = (k: string) => werte[k] ?? stand.werte[k] ?? PER_SCHLUESSEL.get(k)!.standard;
      try {
        await optionen.testeDatenbank({ host: w('DB_HOST'), port: Number(w('DB_PORT')), name: w('DB_NAME'), user: w('DB_USER'), password: w('DB_PASSWORD') });
      } catch (e) {
        throw new DatenbankNichtErreichbar((e as Error).message);
      }
    }

    const jetzt = isoUtc(new Date());
    await transaktion(db, async (c) => {
      for (const a of aenderungen) {
        await c.query('INSERT INTO konfiguration_protokoll (zeit, benutzer_id, schluessel, alt, neu) VALUES (?, ?, ?, ?, ?)', [
          jetzt, benutzerId, a.schluessel, protokollWert(a.schluessel, a.alt), protokollWert(a.schluessel, a.neu),
        ]);
      }
      // Die Datei entsteht zuletzt. Scheitert das Schreiben, verwirft die Transaktion das Protokoll.
      schreibeDatei(q.pfad, setzeInEnvText(stand.text, werte));
    });
    return aenderungen;
  });
}

function schreibeDatei(pfad: string, text: string): void {
  const vorhanden = existsSync(pfad);
  const modus = vorhanden ? statSync(pfad).mode & 0o777 : 0o600;
  const tmp = `${pfad}.neu`;
  writeFileSync(tmp, text, { encoding: 'utf8', mode: modus });
  if (vorhanden) copyFileSync(pfad, `${pfad}.vorher`);
  renameSync(tmp, pfad);
}

export interface ProtokollEintrag {
  zeit: string;
  benutzer: string | null;
  schluessel: string;
  alt: string | null;
  neu: string | null;
}

export async function letzteKonfigAenderungen(db: Db, anzahl = 50): Promise<ProtokollEintrag[]> {
  return alle<ProtokollEintrag>(
    db,
    `SELECT p.zeit, b.name AS benutzer, p.schluessel, p.alt, p.neu FROM konfiguration_protokoll p
     LEFT JOIN benutzer b ON b.id = p.benutzer_id ORDER BY p.id DESC LIMIT ?`,
    [anzahl],
  );
}
