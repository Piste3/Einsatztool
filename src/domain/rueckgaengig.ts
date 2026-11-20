// Rückgängig für Änderungen an Anmeldungen (Wunsch Yann, 19.11.2026).
//
// Ablauf: Eine Route führt eine Aktion in mitRueckgaengig() aus. Die Funktionen in anmeldung.ts
// melden dabei jeden Eintrag vor der Änderung (merkeVorher). Nach der Aktion liest das Tool
// die neue Version jedes Eintrags und legt ein Paket im Speicher ab. Der Toast und die Navigation
// zeigen den Knopf «Rückgängig». Ein Klick stellt alle Einträge des Pakets in einer Transaktion wieder her.
//
// Regeln:
// - Nur der Benutzer, der die Aktion ausgeführt hat, kann sie rückgängig machen (Wunsch Yann, 20.11.2026).
// - Je Benutzer bleiben die letzten 20 Aktionen der letzten 12 Stunden. Jedes Paket gilt nur einmal.
// - Der Knopf in der Navigation macht immer die neueste eigene Aktion rückgängig, dann die davor.
// - Wiederholen (Wunsch Yann, 20.11.2026): Rückgängig merkt sich dabei den Stand vor dem Zurücksetzen
//   als Paket der Art «wiederholen». Wiederholen ist dasselbe Zurücksetzen auf diesen Stand und legt
//   wieder ein Paket der Art «aktion» an. Eine neue eigene Aktion löscht die eigenen Wiederholen-Pakete.
// - Hat sich ein Eintrag seither geändert (Version), ändert das Tool nichts (Konflikt).
// - Jede Wiederherstellung schreibt Einträge ins Statusprotokoll.
// - Pakete liegen im Speicher. Nach einem Neustart sind sie weg (ein Server-Prozess).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, STATUS_TEXT, type Status } from './eingabe.js';
import type { Anmeldung } from './anmeldung.js';
import { jetztIso } from './zeit.js';

export const GUELTIG_MS = 12 * 60 * 60 * 1000;
const MAX_PAKETE = 2000;
export const MAX_JE_BENUTZER = 20;

type Zeile = Record<string, unknown>;

interface Schritt {
  id: number;
  /** Eintrag vor der Aktion. null = die Aktion hat den Eintrag angelegt. */
  vorher: Anmeldung | null;
  /** Statusprotokoll vor dem Entfernen (nur bei entfernten Einträgen). */
  log: Zeile[];
  /** Version nach der Aktion. null = die Aktion hat den Eintrag entfernt. */
  nachher: number | null;
}

/** aktion = lässt sich rückgängig machen, wiederholen = ein rückgängig gemachter Schritt. */
export type Art = 'aktion' | 'wiederholen';

interface Paket {
  art: Art;
  benutzerId: number;
  /** Zeitpunkt der Aktion (ms). */
  zeit: number;
  ablauf: number;
  /** Kurzer Text für den Knopf, z. B. «Lea Meier: angemeldet → bestätigt». */
  beschreibung: string;
  schritte: Schritt[];
}

/** Die neueste Aktion eines Benutzers, die sich rückgängig machen lässt. */
export interface LetzteAktion {
  schluessel: string;
  beschreibung: string;
  zeit: number;
  /** Zahl der Aktionen, die sich insgesamt rückgängig machen lassen. */
  anzahl: number;
}

interface Sammlung {
  vorher: Map<number, { zeile: Anmeldung | null; log: Zeile[] }>;
}

const sammler = new AsyncLocalStorage<Sammlung>();
const pakete = new Map<string, Paket>();

/** Meldet einen Eintrag vor einer Änderung. Ohne laufendes mitRueckgaengig() tut die Funktion nichts. */
export function merkeVorher(zeile: Anmeldung): void {
  const s = sammler.getStore();
  if (!s || s.vorher.has(zeile.id)) return;
  s.vorher.set(zeile.id, { zeile: { ...zeile }, log: [] });
}

/** Meldet einen neu angelegten Eintrag. */
export function merkeNeu(id: number): void {
  const s = sammler.getStore();
  if (!s || s.vorher.has(id)) return;
  s.vorher.set(id, { zeile: null, log: [] });
}

/** Meldet einen Eintrag vor dem Entfernen, mit seinem Statusprotokoll. */
export async function merkeVorEntfernen(c: Db, zeile: Anmeldung): Promise<void> {
  const s = sammler.getStore();
  if (!s) return;
  const log = await alle<Zeile>(c, 'SELECT * FROM status_log WHERE anmeldung_id = ? ORDER BY id', [zeile.id]);
  const bisher = s.vorher.get(zeile.id);
  if (bisher) bisher.log = log;
  else s.vorher.set(zeile.id, { zeile: { ...zeile }, log });
}

/**
 * Führt eine Aktion aus und merkt sich den Stand vorher.
 * Gibt das Ergebnis und einen Schlüssel für «Rückgängig» zurück. Ohne Änderung ist der Schlüssel null.
 */
export async function mitRueckgaengig<T>(db: Db, benutzerId: number, fn: () => Promise<T>): Promise<{ ergebnis: T; schluessel: string | null }> {
  const s: Sammlung = { vorher: new Map() };
  const ergebnis = await sammler.run(s, fn);
  const schluessel = await paketAus(db, s, benutzerId, 'aktion');
  // Eine neue Aktion beendet die Kette: Rückgängig gemachte Schritte lassen sich nicht mehr wiederholen.
  if (schluessel) for (const [k, q] of pakete) if (q.benutzerId === benutzerId && q.art === 'wiederholen') pakete.delete(k);
  return { ergebnis, schluessel };
}

/** Legt aus dem gesammelten Stand ein Paket an. Ohne Änderung: null. */
async function paketAus(db: Db, s: Sammlung, benutzerId: number, art: Art, text?: string): Promise<string | null> {
  if (!s.vorher.size) return null;
  const ids = [...s.vorher.keys()];
  const jetzt = await alle<{ id: number; version: number; status: Status; schicht_id: number; person_id: number | null; name_text: string }>(
    db, 'SELECT id, version, status, schicht_id, person_id, name_text FROM anmeldung WHERE id IN (?)', [ids]);
  const versionen = new Map(jetzt.map((z) => [z.id, z.version]));
  const nachZeile = new Map(jetzt.map((z) => [z.id, z]));
  const schritte: Schritt[] = [];
  for (const [id, v] of s.vorher) {
    const nachher = versionen.get(id) ?? null;
    // Angelegt und gleich wieder weg, oder ohne Änderung: nichts zu tun.
    if (v.zeile === null && nachher === null) continue;
    if (v.zeile !== null && nachher === v.zeile.version) continue;
    schritte.push({ id, vorher: v.zeile, log: v.log, nachher });
  }
  if (!schritte.length) return null;
  const zeit = Date.now();
  return legeAb({ art, benutzerId, zeit, ablauf: zeit + GUELTIG_MS, beschreibung: text ?? beschreibe(schritte, nachZeile), schritte });
}

type NachZeile = { status: Status; schicht_id: number; person_id: number | null; name_text: string };

/** Kurzer Text zur Aktion. Er erscheint im Knopf «Rückgängig» (nur für den Benutzer selbst). */
function beschreibe(schritte: Schritt[], nach: Map<number, NachZeile>): string {
  const st = (x: Status) => STATUS_TEXT[x] ?? x;
  if (schritte.length === 1) {
    const s = schritte[0];
    const n = nach.get(s.id);
    if (!s.vorher) return `${n?.name_text ?? 'Eintrag'} eingetragen (${n ? st(n.status) : ''})`;
    const name = s.vorher.name_text;
    if (!n) return `${name} entfernt`;
    if (n.schicht_id !== s.vorher.schicht_id) return `${name} verschoben`;
    if (n.person_id !== s.vorher.person_id) return `${n.name_text} zugeordnet`;
    if (n.status !== s.vorher.status) return `${name}: ${st(s.vorher.status)} → ${st(n.status)}`;
    return `${name} geändert`;
  }
  const neu = new Set(schritte.map((s) => nach.get(s.id)?.status ?? null));
  const [einziger] = [...neu];
  return neu.size === 1 && einziger ? `${schritte.length} Einträge: ${st(einziger)}` : `${schritte.length} Einträge geändert`;
}

function raeumeAuf(): void {
  const jetzt = Date.now();
  for (const [k, alt] of pakete) if (alt.ablauf < jetzt) pakete.delete(k);
}

function legeAb(p: Paket): string {
  raeumeAuf();
  while (pakete.size >= MAX_PAKETE) pakete.delete(pakete.keys().next().value!);
  // Je Benutzer nur die neuesten Aktionen behalten.
  const eigene = [...pakete].filter(([, q]) => q.benutzerId === p.benutzerId && q.art === p.art);
  for (const [k] of eigene.slice(0, Math.max(0, eigene.length - MAX_JE_BENUTZER + 1))) pakete.delete(k);
  const schluessel = randomBytes(18).toString('base64url');
  pakete.set(schluessel, p);
  return schluessel;
}

/** Die neueste eigene Aktion, die sich rückgängig machen lässt. null = keine. */
export function letzteAktion(benutzerId: number, art: Art = 'aktion'): LetzteAktion | null {
  const jetzt = Date.now();
  let letzte: [string, Paket] | null = null;
  let anzahl = 0;
  for (const e of pakete) {
    if (e[1].benutzerId !== benutzerId || e[1].art !== art || e[1].ablauf < jetzt) continue;
    anzahl++;
    // Die Map behält die Reihenfolge des Anlegens: Der letzte Treffer ist der neueste.
    letzte = e;
  }
  return letzte ? { schluessel: letzte[0], beschreibung: letzte[1].beschreibung, zeit: letzte[1].zeit, anzahl } : null;
}

/** Text einer eigenen Aktion, für die Meldung nach dem Rückgängigmachen. */
export function beschreibungVon(schluessel: unknown, benutzerId: number): string | null {
  const k = gueltigerSchluessel(schluessel);
  const p = k ? pakete.get(k) : undefined;
  return p && p.benutzerId === benutzerId ? p.beschreibung : null;
}

/** Prüft einen Schlüssel aus einem Formular (nur Zeichen aus base64url). */
export function gueltigerSchluessel(wert: unknown): string | null {
  return typeof wert === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(wert) ? wert : null;
}

const FELDER = ['status', 'rolle', 'kanal', 'bemerkung'] as const;

/**
 * Macht eine Aktion rückgängig. Alles oder nichts, in einer Transaktion.
 * Gibt die Zahl der wiederhergestellten Einträge zurück.
 */
export async function macheRueckgaengig(db: Db, schluessel: unknown, benutzerId: number): Promise<number> {
  return (await setzeZurueck(db, schluessel, benutzerId, 'aktion')).anzahl;
}

/** Führt einen rückgängig gemachten Schritt wieder aus. */
export async function wiederhole(db: Db, schluessel: unknown, benutzerId: number): Promise<number> {
  return (await setzeZurueck(db, schluessel, benutzerId, 'wiederholen')).anzahl;
}

export interface Zurueckgesetzt {
  anzahl: number;
  beschreibung: string;
  /** Schlüssel für den Gegenschritt: nach Rückgängig «Wiederholen», nach Wiederholen «Rückgängig». */
  gegenSchluessel: string | null;
}

/**
 * Setzt die Einträge eines Pakets auf den gemerkten Stand zurück. Alles oder nichts, in einer Transaktion.
 * Merkt sich dabei den Stand davor als Gegenschritt.
 */
export async function setzeZurueck(db: Db, schluessel: unknown, benutzerId: number, art: Art): Promise<Zurueckgesetzt> {
  const wort = art === 'aktion' ? 'Rückgängig' : 'Wiederholen';
  const KONFLIKT = `${wort} geht nicht mehr. Jemand hat den Eintrag inzwischen geändert. Das Tool hat nichts geändert.`;
  const k = gueltigerSchluessel(schluessel);
  const p = k ? pakete.get(k) : undefined;
  if (!k || !p || p.benutzerId !== benutzerId || p.art !== art || p.ablauf < Date.now()) {
    throw new Eingabefehler(art === 'aktion'
      ? 'Rückgängig geht nicht mehr. Die Aktion ist zu alt oder schon rückgängig gemacht.'
      : 'Wiederholen geht nicht mehr. Der Schritt ist zu alt oder schon wiederholt.');
  }
  const gegen: Sammlung = { vorher: new Map() };
  // Neue Versionen nach dem Zurücksetzen. Ältere Aktionen desselben Benutzers auf denselben
  // Einträgen erwarten danach diese Version (sonst ginge nur die neueste Aktion rückgängig).
  const neueVersion = new Map<number, { erwartet: number; neu: number }>();
  let n: number;
  try {
    n = await sammler.run(gegen, () => transaktion(db, async (c) => {
    neueVersion.clear();
    gegen.vorher.clear();
    const zeit = jetztIso();
    for (const s of p.schritte) {
      const jetzt = await eine<Anmeldung>(c, 'SELECT * FROM anmeldung WHERE id = ? FOR UPDATE', [s.id]);
      if (s.nachher === null) {
        // Entfernt: Eintrag und Statusprotokoll wieder anlegen.
        if (jetzt || !s.vorher) throw new Eingabefehler(KONFLIKT);
        const doppelt = s.vorher.person_id === null
          ? null
          : await eine(c, 'SELECT id FROM anmeldung WHERE schicht_id = ? AND person_id = ?', [s.vorher.schicht_id, s.vorher.person_id]);
        const schicht = await eine(c, 'SELECT id FROM schicht WHERE id = ?', [s.vorher.schicht_id]);
        if (doppelt || !schicht) throw new Eingabefehler(KONFLIKT);
        await fuegeZeileEin(c, 'anmeldung', { ...s.vorher, version: s.vorher.version + 1, geaendert_am: zeit });
        merkeNeu(s.id);
        neueVersion.set(s.id, { erwartet: s.vorher.version, neu: s.vorher.version + 1 });
        for (const l of s.log) await fuegeZeileEin(c, 'status_log', l);
        await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
          s.id, zeit, benutzerId, 'wiederhergestellt', null, s.vorher.status,
        ]);
        continue;
      }
      if (!jetzt || jetzt.version !== s.nachher) throw new Eingabefehler(KONFLIKT);
      if (s.vorher === null) {
        // Angelegt: Eintrag wieder entfernen (Klick auf «Rückgängig» ist die Bestätigung).
        await merkeVorEntfernen(c, jetzt);
        await schreibe(c, 'DELETE FROM anmeldung WHERE id = ?', [s.id]);
        continue;
      }
      // Geändert: alte Werte zurückschreiben und jede Änderung protokollieren.
      const v = s.vorher;
      for (const feld of FELDER) {
        const alt = (jetzt[feld] ?? null) as string | null;
        const neu = (v[feld] ?? null) as string | null;
        if (alt !== neu) {
          await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
            s.id, zeit, benutzerId, feld, alt, neu,
          ]);
        }
      }
      if (jetzt.schicht_id !== v.schicht_id) {
        // Verschoben: zurück in die alte Schicht, wenn es sie noch gibt und die Person dort keinen Eintrag hat.
        const alt = await eine<{ name: string }>(c, 'SELECT name FROM schicht WHERE id = ?', [v.schicht_id]);
        const doppelt = v.person_id === null
          ? null
          : await eine(c, 'SELECT id FROM anmeldung WHERE schicht_id = ? AND person_id = ? AND id <> ?', [v.schicht_id, v.person_id, s.id]);
        if (!alt || doppelt) throw new Eingabefehler(KONFLIKT);
        const neu = await eine<{ name: string }>(c, 'SELECT name FROM schicht WHERE id = ?', [jetzt.schicht_id]);
        await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
          s.id, zeit, benutzerId, 'verschoben', neu?.name ?? null, alt.name,
        ]);
      }
      if (jetzt.person_id !== v.person_id) {
        await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
          s.id, zeit, benutzerId, 'zuordnung_aufgehoben', `${jetzt.name_text}${jetzt.person_id !== null ? ` (${jetzt.person_id})` : ''}`,
          v.email_text ? `${v.name_text} <${v.email_text}>` : v.name_text,
        ]);
      }
      merkeVorher(jetzt);
      await schreibe(
        c,
        `UPDATE anmeldung SET schicht_id = ?, person_id = ?, name_text = ?, email_text = ?, status = ?, rolle = ?, kanal = ?, bemerkung = ?,
           mail_gesendet_am = ?, geaendert_am = ?, version = version + 1 WHERE id = ?`,
        [v.schicht_id, v.person_id, v.name_text, v.email_text, v.status, v.rolle, v.kanal, v.bemerkung, v.mail_gesendet_am, zeit, s.id],
      );
      neueVersion.set(s.id, { erwartet: v.version, neu: jetzt.version + 1 });
    }
    return p.schritte.length;
    }));
  } catch (fehler) {
    // Ein Konflikt bleibt ein Konflikt. Das Paket verschwindet, der Knopf zeigt die Aktion davor.
    if (fehler instanceof Eingabefehler) pakete.delete(k);
    throw fehler;
  }
  pakete.delete(k);
  for (const q of pakete.values()) {
    if (q.benutzerId !== benutzerId) continue;
    for (const s of q.schritte) {
      const v = neueVersion.get(s.id);
      if (v && s.nachher === v.erwartet) s.nachher = v.neu;
    }
  }
  const gegenSchluessel = await paketAus(db, gegen, benutzerId, art === 'aktion' ? 'wiederholen' : 'aktion', p.beschreibung);
  return { anzahl: n, beschreibung: p.beschreibung, gegenSchluessel };
}

/** Fügt eine Zeile mit allen Spalten ein. Die Spaltennamen kommen aus der Datenbank selbst. */
async function fuegeZeileEin(c: Db, tabelle: 'anmeldung' | 'status_log', zeile: Zeile): Promise<void> {
  const spalten = Object.keys(zeile).filter((s) => /^[a-z_]+$/.test(s));
  await schreibe(
    c,
    `INSERT INTO ${tabelle} (${spalten.map((s) => `\`${s}\``).join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`,
    spalten.map((s) => zeile[s]),
  );
}

/** Nur für Tests: alle Pakete vergessen oder ein Paket altern lassen. */
export function _paketeFuerTests(): Map<string, Paket> {
  return pakete;
}
