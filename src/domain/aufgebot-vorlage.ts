// Aufgebot: ein Brief je bestätigter Person und Schicht (20).
// Der feste Text liegt hier im Code. Änderungen laufen über einen Commit.
import { alle, type Db } from '../db/db.js';
import { ladeSchicht } from './schicht.js';
import { hauptnummer } from './personen.js';
import { datumCh, datumChVonIso, lokalesDatum, lokaleZeit, wochentag } from './zeit.js';
import type { Warnung } from './warnungen.js';

export const FEST = {
  absender: ['KADETTEN-KORPS BASEL', 'Rüchligweg 55', '4125 Riehen'],
  ansprechperson: ['Ansprechperson', 'Aufgebotsstelle', 'aufgebot@kkb.ch'],
  ortDatum: 'Riehen, den',
  einleitung: [
    'Du hast dich für folgenden Einsatz angemeldet. Schon im Voraus herzlichen Dank!',
    'Nachstehend findest du alle nötigen Informationen:',
  ],
  schluss: [
    'Deine Teilnahme ist definitiv. Falls Du am Einsatz nicht teilnehmen kannst, musst du dich umgehend per Mail an aufgebot@kkb.ch wenden. Bei krankheitsbedingten Absagen weniger als drei Tage vor dem Einsatz, melde dich bitte direkt telefonisch bei der Einsatzleitung.',
    'Bei allfäligen Fragen stehe ich dir gerne zur Verfügung.',
  ],
  gruss: 'Freundliche Grüsse',
  unterschrift: ['KADETTEN-KORPS BASEL', 'Aufgebotstelle'],
};

export interface Brief {
  anmeldungId: number;
  personId: number | null;
  rang: string | null;
  name: string;
  strasse: string | null;
  adresszusatz: string | null;
  plzOrt: string | null;
  adresseFehlt: boolean;
}

export interface AufgebotDaten {
  titel: string;
  briefdatum: string;
  antreten: string;
  abtreten: string;
  hinweis: string | null;
  einsatzleitung: string[];
  tenue: string | null;
  briefe: Brief[];
  luecken: Warnung[];
  schichtId: number;
  einsatzId: number;
}

function zeitOrt(iso: string, ort: string | null): string {
  return `${wochentag(iso)}, ${datumChVonIso(iso)} ${lokaleZeit(iso)}${ort ? `, ${ort}` : ''}`;
}

/**
 * Daten für die Briefe einer Schicht. Nur Einträge mit «bestaetigt».
 * Entscheid Yann: Unbekannte Einträge erhalten einen Brief mit «Adresse fehlt». Gelöschte Personen keinen.
 */
export async function aufgebotDaten(db: Db, schichtId: number, nurPerson: number | null = null, heute = new Date()): Promise<AufgebotDaten> {
  const s = await ladeSchicht(db, schichtId);
  const eintraege = await alle<any>(
    db,
    `SELECT a.id, a.person_id, a.name_text, a.rolle, p.vorname, p.nachname, p.strasse, p.adresszusatz, p.plz, p.ort,
            p.telefon, p.telefon_privat, p.geloescht_am, r.name AS rang, r.reihenfolge
       FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
      WHERE a.schicht_id = ? AND a.status = 'bestaetigt'
      ORDER BY (r.reihenfolge IS NULL), r.reihenfolge DESC, p.nachname, p.vorname, a.name_text`,
    [schichtId],
  );
  const aktiv = eintraege.filter((e) => !e.geloescht_am);

  // Regel 20.3: Einsatzleitung = alle bestätigten Personen mit Rolle Einsatzleitung.
  const el = aktiv
    .filter((e) => e.rolle === 'Einsatzleitung')
    .map((e) => {
      const name = e.person_id ? `${e.vorname ?? ''} ${e.nachname ?? ''}`.trim() : e.name_text;
      const tel = hauptnummer(e);
      return `EL: ${e.rang ? `${e.rang} ` : ''}${name}${tel ? ` (${tel})` : ''}`;
    });

  const briefe: Brief[] = aktiv
    .filter((e) => nurPerson === null || e.person_id === nurPerson)
    .map((e) => {
      const bekannt = e.person_id !== null;
      const plzOrt = bekannt ? [e.plz, e.ort].filter(Boolean).join(' ') || null : null;
      return {
        anmeldungId: e.id,
        personId: e.person_id,
        rang: bekannt ? e.rang : null,
        name: bekannt ? `${e.vorname ?? ''} ${e.nachname ?? ''}`.trim() : e.name_text,
        strasse: bekannt ? e.strasse : null,
        adresszusatz: bekannt ? e.adresszusatz : null,
        plzOrt,
        adresseFehlt: !bekannt || !e.strasse || !e.plz || !e.ort,
      };
    });

  // Regel 20.5: Liste der Lücken. Sie sperrt den Druck nicht.
  const luecken: Warnung[] = [];
  if (!s.ort) luecken.push({ code: 'W_ORT_ANTRETEN', text: 'Ort Antreten ist leer.' });
  if (!el.length) luecken.push({ code: 'W_EINSATZLEITUNG', text: 'Keine Einsatzleitung bestätigt.' });
  if (!s.tenue) luecken.push({ code: 'W_TENUE', text: 'Tenue ist leer.' });
  for (const b of briefe) if (b.adresseFehlt) luecken.push({ code: 'W_ADRESSE', text: `Adresse fehlt: ${b.name}.` });

  // Regel 20.2 (Automatisches Füllen): Titel mit oder ohne Schichtname.
  const titel = s.anzahl_schichten === 1 ? `Einsatzaufgebot - ${s.einsatz_name}` : `Einsatzaufgebot - ${s.einsatz_name} - ${s.name}`;
  return {
    titel,
    briefdatum: datumCh(lokalesDatum(heute)),
    antreten: zeitOrt(s.start_zeit, s.ort),
    // Regel 20: Ort Abtreten leer = gleich wie Ort.
    abtreten: zeitOrt(s.end_zeit, s.abtreten_ort || s.ort),
    hinweis: s.aufgebot_hinweis,
    einsatzleitung: el,
    tenue: s.tenue,
    briefe,
    luecken,
    schichtId: s.id,
    einsatzId: s.einsatz_id,
  };
}
