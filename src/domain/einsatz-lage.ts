// Lage eines Einsatzes: Liste «Zu tun» für die Übersicht (Konzept Einsatzansicht, Yann 19.11.2026).
// Nur Anzeige. Die Liste sperrt keine Aktion (Warnen statt verbieten).
// Seit 23.11.2026 (Wunsch Yann): nur wichtige Punkte, höchstens eine Zeile je Art.
// Seit 26.11.2026 (Wunsch Yann) auch keine fehlenden Personen: Die Schichten-Tabelle zeigt sie.
// Unsichere Personen, offene Nachrichten, Warnungen bei Einträgen, Rollenbedarf und Clubdesk-Abgleich
// stehen nicht mehr hier. Sie zeigen sich in «Besetzen» und in der Schichten-Tabelle.
import type { SchichtZahlen } from './zaehlung.js';

export type ZuTunArt = 'zeit_offen' | 'einsatzleitung' | 'unbestaetigt' | 'kein_soll';

export interface ZuTunPunkt {
  art: ZuTunArt;
  /** Betroffene Schicht. Leer bei Punkten für mehrere Schichten oder den ganzen Einsatz. */
  schichtId: number | null;
  /** Zahl für das Symbol links (0 = Ausrufezeichen). */
  anzahl: number;
  text: string;
  /** Ergänzung in grauer Schrift. */
  unter?: string;
}

export interface LageEingabe {
  jetzt: string;
  schichten: { id: number; name: string; end_zeit: string; soll_anzahl: number | null; zeit_offen?: number }[];
  zahlen: Map<number, SchichtZahlen>;
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

/**
 * Liste «Zu tun»: nur kommende Schichten, nur Punkte mit Handlungsbedarf, keine Nullen.
 * Jede Art erscheint höchstens einmal. Bei mehreren Schichten nennt die Zeile die Schichten.
 * Ohne Soll meldet die Liste «Kein Soll festgelegt» und nie «besetzt».
 */
export function einsatzLage(e: LageEingabe): Lage {
  const kommend = e.schichten.filter((s) => s.end_zeit > e.jetzt && e.zahlen.has(s.id));
  const mehrere = e.schichten.length > 1;
  const namen = (liste: { name: string }[]) => liste.map((s) => s.name).join(', ');
  const punkte: ZuTunPunkt[] = [];

  // Wunsch Yann: Ein Einsatz entsteht auch ohne Zeiten. Die Zeiten trägt die Aufgebotsstelle später nach.
  const ohneZeit = kommend.filter((s) => Number(s.zeit_offen));
  if (ohneZeit.length) {
    punkte.push({ art: 'zeit_offen', schichtId: ohneZeit[0].id, anzahl: 0, text: mehrere ? `Zeiten fehlen: ${namen(ohneZeit)}.` : 'Beginn oder Ende fehlt noch.' });
  }

  // Einsatzleitung fehlt. Den übrigen Rollenbedarf zeigt die Schichten-Tabelle (Wunsch Yann 23.11.2026).
  const ohneEl = e.mitEinsatzleitung ? kommend.filter((s) => !e.mitEinsatzleitung!.has(s.id)) : [];

  if (ohneEl.length) {
    punkte.push({ art: 'einsatzleitung', schichtId: ohneEl[0].id, anzahl: 0, text: mehrere ? `Keine Einsatzleitung eingeteilt: ${namen(ohneEl)}.` : 'Keine Einsatzleitung eingeteilt.' });
  }

  const unbestaetigt = kommend.reduce((n, s) => n + e.zahlen.get(s.id)!.unbestaetigt, 0);
  if (unbestaetigt > 0) {
    punkte.push({ art: 'unbestaetigt', schichtId: null, anzahl: unbestaetigt, text: unbestaetigt === 1 ? '1 Anmeldung wartet auf Bestätigung.' : `${unbestaetigt} Anmeldungen warten auf Bestätigung.` });
  }

  const ohneSoll = kommend.filter((s) => s.soll_anzahl === null || s.soll_anzahl <= 0);
  if (ohneSoll.length) {
    punkte.push({ art: 'kein_soll', schichtId: ohneSoll[0].id, anzahl: 0, text: mehrere ? `Kein Soll festgelegt: ${namen(ohneSoll)}.` : 'Kein Soll festgelegt.' });
  }

  return { vorbei: e.schichten.length > 0 && e.schichten.every((s) => s.end_zeit <= e.jetzt), punkte, unbestaetigt };
}
