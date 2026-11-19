// Rückgängig für Änderungen an Anmeldungen (Wunsch Yann, 19.11.2026).
//
// Ablauf: Eine Route führt eine Aktion in mitRueckgaengig() aus. Die Funktionen in anmeldung.ts
// melden dabei jeden Eintrag vor der Änderung (merkeVorher). Nach der Aktion liest das Tool
// die neue Version jedes Eintrags und legt ein Paket im Speicher ab. Der Toast zeigt den Knopf
// «Rückgängig». Ein Klick stellt alle Einträge des Pakets in einer Transaktion wieder her.
//
// Regeln:
// - Nur der Benutzer, der die Aktion ausgeführt hat, kann sie rückgängig machen.
// - Ein Paket gilt 10 Minuten und nur einmal.
// - Hat sich ein Eintrag seither geändert (Version), ändert das Tool nichts (Konflikt).
// - Jede Wiederherstellung schreibt Einträge ins Statusprotokoll.
// - Pakete liegen im Speicher. Nach einem Neustart sind sie weg (ein Server-Prozess).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler } from './eingabe.js';
import type { Anmeldung } from './anmeldung.js';
import { jetztIso } from './zeit.js';

export const GUELTIG_MS = 10 * 60 * 1000;
const MAX_PAKETE = 2000;

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

interface Paket {
  benutzerId: number;
  ablauf: number;
  schritte: Schritt[];
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
  if (!s.vorher.size) return { ergebnis, schluessel: null };
  const ids = [...s.vorher.keys()];
  const jetzt = await alle<{ id: number; version: number }>(db, 'SELECT id, version FROM anmeldung WHERE id IN (?)', [ids]);
  const versionen = new Map(jetzt.map((z) => [z.id, z.version]));
  const schritte: Schritt[] = [];
  for (const [id, v] of s.vorher) {
    const nachher = versionen.get(id) ?? null;
    // Angelegt und gleich wieder weg, oder ohne Änderung: nichts zu tun.
    if (v.zeile === null && nachher === null) continue;
    if (v.zeile !== null && nachher === v.zeile.version) continue;
    schritte.push({ id, vorher: v.zeile, log: v.log, nachher });
  }
  if (!schritte.length) return { ergebnis, schluessel: null };
  return { ergebnis, schluessel: legeAb({ benutzerId, ablauf: Date.now() + GUELTIG_MS, schritte }) };
}

function legeAb(p: Paket): string {
  const jetzt = Date.now();
  for (const [k, alt] of pakete) if (alt.ablauf < jetzt) pakete.delete(k);
  while (pakete.size >= MAX_PAKETE) pakete.delete(pakete.keys().next().value!);
  const schluessel = randomBytes(18).toString('base64url');
  pakete.set(schluessel, p);
  return schluessel;
}

/** Prüft einen Schlüssel aus einem Formular (nur Zeichen aus base64url). */
export function gueltigerSchluessel(wert: unknown): string | null {
  return typeof wert === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(wert) ? wert : null;
}

const FELDER = ['status', 'rolle', 'kanal', 'bemerkung'] as const;
const KONFLIKT = 'Rückgängig geht nicht mehr. Jemand hat den Eintrag inzwischen geändert. Das Tool hat nichts geändert.';

/**
 * Macht eine Aktion rückgängig. Alles oder nichts, in einer Transaktion.
 * Gibt die Zahl der wiederhergestellten Einträge zurück.
 */
export async function macheRueckgaengig(db: Db, schluessel: unknown, benutzerId: number): Promise<number> {
  const k = gueltigerSchluessel(schluessel);
  const p = k ? pakete.get(k) : undefined;
  if (!k || !p || p.benutzerId !== benutzerId || p.ablauf < Date.now()) {
    throw new Eingabefehler('Rückgängig geht nicht mehr. Die Aktion ist zu alt oder schon rückgängig gemacht.');
  }
  const n = await transaktion(db, async (c) => {
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
        for (const l of s.log) await fuegeZeileEin(c, 'status_log', l);
        await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
          s.id, zeit, benutzerId, 'wiederhergestellt', null, s.vorher.status,
        ]);
        continue;
      }
      if (!jetzt || jetzt.version !== s.nachher) throw new Eingabefehler(KONFLIKT);
      if (s.vorher === null) {
        // Angelegt: Eintrag wieder entfernen (Klick auf «Rückgängig» ist die Bestätigung).
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
      if (jetzt.person_id !== v.person_id) {
        await schreibe(c, 'INSERT INTO status_log (anmeldung_id, zeit, benutzer_id, aktion, alt_wert, neu_wert) VALUES (?, ?, ?, ?, ?, ?)', [
          s.id, zeit, benutzerId, 'zuordnung_aufgehoben', `${jetzt.name_text}${jetzt.person_id !== null ? ` (${jetzt.person_id})` : ''}`,
          v.email_text ? `${v.name_text} <${v.email_text}>` : v.name_text,
        ]);
      }
      await schreibe(
        c,
        `UPDATE anmeldung SET person_id = ?, name_text = ?, email_text = ?, status = ?, rolle = ?, kanal = ?, bemerkung = ?,
           mail_gesendet_am = ?, geaendert_am = ?, version = version + 1 WHERE id = ?`,
        [v.person_id, v.name_text, v.email_text, v.status, v.rolle, v.kanal, v.bemerkung, v.mail_gesendet_am, zeit, s.id],
      );
    }
    return p.schritte.length;
  });
  pakete.delete(k);
  return n;
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
