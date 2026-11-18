// Abgleich der Schichten mit dem iCal-Feed von Clubdesk (17.4).
// Der Stand liegt im Speicher. Der Job ical-cache.ts füllt ihn.
import { lokalesDatum } from './zeit.js';

export interface FeedTermin {
  titel: string;
  start: string; // UTC ISO
  ende: string; // UTC ISO
}

export type AbgleichStatus = 'ok' | 'zeit_abweicht' | 'fehlt' | 'unbekannt';

export interface AbgleichErgebnis {
  status: AbgleichStatus;
  termin?: FeedTermin;
}

interface FeedStand {
  termine: FeedTermin[] | null;
  geladenAm: string | null;
  fehlerSeit: string | null;
  fehler: string | null;
}

const stand: FeedStand = { termine: null, geladenAm: null, fehlerSeit: null, fehler: null };

export function feedStand(): Readonly<FeedStand> {
  return stand;
}

export function setzeFeed(termine: FeedTermin[], zeit: string): void {
  stand.termine = termine;
  stand.geladenAm = zeit;
  stand.fehlerSeit = null;
  stand.fehler = null;
}

/** Regel 17.4.2: Schlägt das Holen fehl, bleibt der alte Stand. */
export function setzeFeedFehler(meldung: string, zeit: string): void {
  if (!stand.fehlerSeit) stand.fehlerSeit = zeit;
  stand.fehler = meldung;
}

export function leereFeed(): void {
  stand.termine = null;
  stand.geladenAm = null;
  stand.fehlerSeit = null;
  stand.fehler = null;
}

/** Regel 17.4.4: Leerzeichen am Rand weg, mehrfache Leerzeichen zu einem, Kleinschreibung. */
export function normalisiereTitel(t: string): string {
  return t.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Regel 17.4.4 und 17.4.5: Termin mit gleichem Titel suchen. Bei mehreren Treffern gilt der
 * Treffer mit gleichem Starttag. Ergebnis ok, zeit_abweicht oder fehlt.
 */
export function gleicheAb(titel: string, start: string, ende: string, termine: FeedTermin[] | null): AbgleichErgebnis {
  if (!termine) return { status: 'unbekannt' };
  const n = normalisiereTitel(titel);
  const treffer = termine.filter((t) => normalisiereTitel(t.titel) === n);
  if (!treffer.length) return { status: 'fehlt' };
  const tag = lokalesDatum(start);
  const gewaehlt = treffer.find((t) => lokalesDatum(t.start) === tag) ?? treffer[0];
  const gleich = new Date(gewaehlt.start).getTime() === new Date(start).getTime() &&
    new Date(gewaehlt.ende).getTime() === new Date(ende).getTime();
  return { status: gleich ? 'ok' : 'zeit_abweicht', termin: gewaehlt };
}

/** Abgleich mit dem aktuellen Stand im Speicher. */
export function abgleichFuerSchicht(titel: string, start: string, ende: string): AbgleichErgebnis {
  return gleicheAb(titel, start, ende, stand.termine);
}
