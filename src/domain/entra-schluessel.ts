// Ablauf des Clientschlüssels für den Login mit Microsoft Entra (Wunsch Yann 23.11.2026).
// Der Admin trägt das Ablaufdatum in Admin › Einstellungen › Login ein (ENTRA_SECRET_ABLAUF).
// Ab 30 Tage vorher warnt das Cockpit. Die Warnung sperrt nichts.
import { istDatum, lokalesDatum, plusTage, tageZwischen } from './zeit.js';

/** Ab so vielen Tagen vor dem Ablauf warnt das Tool. */
export const WARNUNG_TAGE = 30;

export type EntraAblauf =
  /** Der Login mit Entra ist nicht eingerichtet. Das Tool prüft nichts. */
  | { stufe: 'ohne_login' }
  /** Das Ablaufdatum fehlt. */
  | { stufe: 'fehlt' }
  | { stufe: 'ok' | 'bald' | 'abgelaufen'; datum: string; tage: number };

/**
 * Stand des Schlüssels am Tag «heute» (JJJJ-MM-TT, lokale Zeit).
 * tage = Tage bis zum Ablauf. 0 = läuft heute ab (gilt als «bald»). Negativ = abgelaufen.
 */
export function entraAblauf(werte: Record<string, string | undefined>, heute: string = lokalesDatum(new Date())): EntraAblauf {
  if (!werte.ENTRA_TENANT_ID) return { stufe: 'ohne_login' };
  const datum = (werte.ENTRA_SECRET_ABLAUF ?? '').trim();
  if (!istDatum(datum)) return { stufe: 'fehlt' };
  const tage = tageZwischen(heute, datum);
  return { stufe: tage < 0 ? 'abgelaufen' : tage <= WARNUNG_TAGE ? 'bald' : 'ok', datum, tage };
}

/** Vorschlag für ein neues Ablaufdatum: heute plus 2 Jahre. Der 29. Februar wird zum 28. Februar. */
export function inZweiJahren(heute: string = lokalesDatum(new Date())): string {
  const [j, m, t] = heute.split('-').map(Number);
  const ziel = `${j + 2}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
  return istDatum(ziel) ? ziel : plusTage(`${j + 2}-${String(m).padStart(2, '0')}-01`, t - 2);
}

/** Text der Warnung, z. B. «Der Entra-Schlüssel läuft in 12 Tagen ab (05.12.2026).». */
export function ablaufText(a: EntraAblauf, datumCh: (d: string) => string): string {
  if (a.stufe === 'fehlt') return 'Das Ablaufdatum des Entra-Schlüssels fehlt.';
  if (a.stufe === 'ohne_login') return '';
  const d = datumCh(a.datum);
  if (a.stufe === 'abgelaufen') return `Der Entra-Schlüssel ist am ${d} abgelaufen. Neue Anmeldungen scheitern, bis du ihn erneuerst.`;
  if (a.tage === 0) return `Der Entra-Schlüssel läuft heute ab (${d}).`;
  return `Der Entra-Schlüssel läuft in ${a.tage} ${a.tage === 1 ? 'Tag' : 'Tagen'} ab (${d}).`;
}
