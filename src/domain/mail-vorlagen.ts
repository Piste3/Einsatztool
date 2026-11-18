// Feste Vorlage der Bestätigungsmail (18.2). Änderungen am Text laufen über einen Commit.
import { datumChVonIso, lokaleZeit, wochentag } from './zeit.js';

export interface BestaetigteSchicht {
  einsatz: string;
  schicht: string;
  start: string;
  ende: string;
  ort: string | null;
  rolle: string | null;
}

export const ABSENDER_NAME = 'Kadetten-Korps Basel, Aufgebotsstelle';
export const BETREFF_BESTAETIGUNG = 'Bestätigung deiner Anmeldung';

export function bestaetigungsText(vorname: string, schichten: BestaetigteSchicht[]): string {
  const bloecke = schichten.map((s) => {
    const z = [
      `Einsatz: ${s.einsatz}`,
      `Schicht: ${s.schicht}`,
      `Datum: ${wochentag(s.start)} ${datumChVonIso(s.start)}`,
      `Zeit: ${lokaleZeit(s.start)}–${lokaleZeit(s.ende)}`,
      `Ort: ${s.ort ?? ''}`,
    ];
    if (s.rolle) z.push(`Rolle: ${s.rolle}`);
    return z.join('\n');
  });
  return [
    `Hallo ${vorname}`.trim(),
    '',
    'Wir bestätigen deine Teilnahme:',
    '',
    bloecke.join('\n\n'),
    '',
    'Bei Fragen antworte auf diese Mail.',
    '',
    'Freundliche Grüsse',
    ABSENDER_NAME,
    '',
  ].join('\n');
}
