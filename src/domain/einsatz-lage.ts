// Lage eines Einsatzes: Liste «Zu tun» für die Übersicht (Konzept Einsatzansicht, Yann 19.11.2026).
// Nur Anzeige. Die Liste sperrt keine Aktion (Warnen statt verbieten).
import type { SchichtZahlen } from './zaehlung.js';
import type { Warnung } from './warnungen.js';

export type ZuTunArt = 'zeit_offen' | 'fehlt' | 'kein_soll' | 'unbestaetigt' | 'offen' | 'warnung' | 'schicht_warnung' | 'einsatzleitung';

export interface ZuTunPunkt {
  art: ZuTunArt;
  /** Betroffene Schicht. Leer bei Punkten für den ganzen Einsatz. */
  schichtId: number | null;
  /** Zahl für das Symbol links (0 = Ausrufezeichen). */
  anzahl: number;
  text: string;
  /** Ergänzung in grauer Schrift. */
  unter?: string;
  /** Status für den Filter in der Schicht («Zeigen»). */
  status?: 'unsicher' | 'nachricht_gesendet';
}

export interface LageEingabe {
  jetzt: string;
  schichten: { id: number; name: string; end_zeit: string; soll_anzahl: number | null; zeit_offen?: number }[];
  zahlen: Map<number, SchichtZahlen>;
  /** Zahl der Warnungen bei Einträgen je Schicht. */
  warnZahl: Map<number, number>;
  /** Warnungen der Schicht selbst. */
  schichtWarnungen: Map<number, Warnung[]>;
  /** Schichten mit Einsatzleitung (angemeldet oder bestätigt). Leer = die Rolle «Einsatzleitung» gibt es nicht. */
  mitEinsatzleitung: Set<number> | null;
}

export interface Lage {
  /** Alle Schichten sind vorbei. */
  vorbei: boolean;
  punkte: ZuTunPunkt[];
  /** Unbestätigte Einträge in kommenden Schichten (Knopf «Alle bestätigen»). */
  unbestaetigt: number;
}

function mehrzahl(n: number, eins: string, viele: string): string {
  return `${n} ${n === 1 ? eins : viele}`;
}

/**
 * Liste «Zu tun»: nur kommende Schichten, nur Punkte mit Handlungsbedarf, keine Nullen.
 * Ohne Soll meldet die Liste «Kein Soll festgelegt» und nie «besetzt».
 */
export function einsatzLage(e: LageEingabe): Lage {
  const kommend = e.schichten.filter((s) => s.end_zeit > e.jetzt);
  const mehrere = e.schichten.length > 1;
  const vor = (s: { name: string }) => (mehrere ? `${s.name}: ` : '');
  const punkte: ZuTunPunkt[] = [];
  let unbestaetigt = 0;

  // Wunsch Yann: Ein Einsatz entsteht auch ohne Zeiten. Die Zeiten trägt die Aufgebotsstelle später nach.
  const ohneZeit = kommend.filter((s) => Number(s.zeit_offen));
  if (ohneZeit.length) {
    punkte.push({ art: 'zeit_offen', schichtId: ohneZeit[0].id, anzahl: 0, text: mehrere ? `Zeiten fehlen: ${ohneZeit.map((s) => s.name).join(', ')}.` : 'Beginn oder Ende fehlt noch.' });
  }

  for (const s of kommend) {
    const z = e.zahlen.get(s.id);
    if (!z) continue;
    unbestaetigt += z.unbestaetigt;
    if (s.soll_anzahl === null || s.soll_anzahl <= 0) {
      punkte.push({ art: 'kein_soll', schichtId: s.id, anzahl: 0, text: `${vor(s)}Kein Soll festgelegt.`, unter: 'Das Tool kann nicht sagen, ob Personen fehlen.' });
    } else if (z.teilnehmende < s.soll_anzahl) {
      const fehlt = s.soll_anzahl - z.teilnehmende;
      punkte.push({ art: 'fehlt', schichtId: s.id, anzahl: fehlt, text: `${vor(s)}${mehrzahl(fehlt, 'Person fehlt', 'Personen fehlen')}.`, unter: `${z.teilnehmende} von ${s.soll_anzahl} bestätigt.` });
    }
  }

  if (unbestaetigt > 0) {
    punkte.push({ art: 'unbestaetigt', schichtId: null, anzahl: unbestaetigt, text: unbestaetigt === 1 ? '1 Anmeldung wartet auf Bestätigung.' : `${unbestaetigt} Anmeldungen warten auf Bestätigung.` });
  }

  for (const s of kommend) {
    const z = e.zahlen.get(s.id);
    if (!z || (!z.unsicher && !z.nachricht)) continue;
    const teile = [
      z.unsicher ? `${mehrzahl(z.unsicher, 'Person ist', 'Personen sind')} unsicher.` : '',
      z.nachricht ? `${mehrzahl(z.nachricht, 'Nachricht ist', 'Nachrichten sind')} ohne Antwort.` : '',
    ].filter(Boolean);
    punkte.push({ art: 'offen', schichtId: s.id, anzahl: z.unsicher + z.nachricht, text: `${vor(s)}${teile.join(' ')}`, status: z.unsicher ? 'unsicher' : 'nachricht_gesendet' });
  }

  for (const s of kommend) {
    for (const w of e.schichtWarnungen.get(s.id) ?? []) {
      punkte.push({ art: 'schicht_warnung', schichtId: s.id, anzahl: 0, text: `${vor(s)}${w.text}` });
    }
    const n = e.warnZahl.get(s.id) ?? 0;
    if (n > 0) punkte.push({ art: 'warnung', schichtId: s.id, anzahl: 0, text: `${vor(s)}${mehrzahl(n, 'Warnung', 'Warnungen')} bei Einträgen.` });
  }

  if (e.mitEinsatzleitung) {
    const ohne = kommend.filter((s) => !e.mitEinsatzleitung!.has(s.id));
    if (ohne.length) {
      punkte.push({
        art: 'einsatzleitung', schichtId: ohne[0].id, anzahl: 0,
        text: mehrere ? `Keine Einsatzleitung eingeteilt: ${ohne.map((s) => s.name).join(', ')}.` : 'Keine Einsatzleitung eingeteilt.',
      });
    }
  }

  return { vorbei: e.schichten.length > 0 && kommend.length === 0, punkte, unbestaetigt };
}
