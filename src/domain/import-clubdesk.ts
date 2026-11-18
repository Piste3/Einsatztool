// Clubdesk-Import (16). Der Import ist die einzige Quelle für Personendaten.
import { parse } from 'csv-parse/sync';
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { CLUBDESK_SPALTEN, VEREINS_DOMAIN, normalisiereUeberschrift, type PersonFeld } from '../config/clubdesk-spalten.js';
import { Eingabefehler } from './eingabe.js';
import { schreibeLog } from './anmeldung.js';
import { jetztIso } from './zeit.js';

/** Felder in der Tabelle person, die der Import vergleicht. */
const DATENFELDER = [
  'vorname', 'nachname', 'geburtsdatum', 'rang_id', 'strasse', 'adresszusatz', 'plz', 'ort',
  'telefon', 'telefon_privat', 'email', 'essenseinschraenkung',
] as const;
type Datenfeld = (typeof DATENFELDER)[number];

export const FELD_TEXT: Record<Datenfeld, string> = {
  vorname: 'Vorname', nachname: 'Nachname', geburtsdatum: 'Geburtsdatum', rang_id: 'Rang', strasse: 'Adresse',
  adresszusatz: 'Adress-Zusatz', plz: 'PLZ', ort: 'Ort', telefon: 'Telefon Mobil', telefon_privat: 'Telefon Privat',
  email: 'E-Mail', essenseinschraenkung: 'Essenseinschränkungen',
};

export type PersonDaten = { clubdesk_id: number } & Record<Datenfeld, string | number | null>;

/** Regel 16.1.1: zuerst strenges UTF-8, sonst Windows-1252. */
export function dekodiere(daten: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(daten);
  } catch {
    text = new TextDecoder('windows-1252').decode(daten);
  }
  return text.replace(/^﻿/, '');
}

/** Regel 16.1.1: Trennzeichen ; oder , aus der ersten Zeile. */
export function erkenneTrennzeichen(text: string): ';' | ',' {
  const erste = text.split(/\r?\n/, 1)[0] ?? '';
  const semi = (erste.match(/;/g) ?? []).length;
  const komma = (erste.match(/,/g) ?? []).length;
  return semi >= komma ? ';' : ',';
}

/** TT.MM.JJJJ → JJJJ-MM-TT. Ungültig = null. */
export function leseDatum(s: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [t, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(j, mo - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== t) return null;
  return `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

export interface GeleseneCsv {
  personen: PersonDaten[];
  fehler: string[];
  hinweise: string[];
  unbekannteRaenge: string[];
  ohneVereinsadresse: number;
}

/**
 * Liest die CSV und prüft sie (16.1, 16.2.1). Nur die Spalten aus clubdesk-spalten.ts.
 * Fehlt eine Pflichtspalte, gibt es einen Fehler mit den gefundenen Überschriften.
 */
export function leseClubdeskCsv(daten: Buffer, raenge: Map<string, number>): GeleseneCsv {
  const text = dekodiere(daten);
  const datensaetze = parse(text, {
    delimiter: erkenneTrennzeichen(text),
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
    info: true,
  }) as unknown as { record: string[]; info: { lines: number } }[];
  if (!datensaetze.length) throw new Eingabefehler('Die Datei ist leer.');
  const kopf = datensaetze[0].record.map((k) => k.trim());
  const index = new Map<string, number>();
  kopf.forEach((k, i) => {
    const n = normalisiereUeberschrift(k);
    if (!index.has(n)) index.set(n, i);
  });
  const spalte: Partial<Record<PersonFeld, number>> = {};
  const fehlend: string[] = [];
  for (const [feld, def] of Object.entries(CLUBDESK_SPALTEN) as [PersonFeld, { ueberschrift: string; pflicht: boolean }][]) {
    const i = index.get(normalisiereUeberschrift(def.ueberschrift));
    if (i === undefined) {
      if (def.pflicht) fehlend.push(def.ueberschrift);
    } else spalte[feld] = i;
  }
  if (fehlend.length) {
    throw new Eingabefehler(
      `Pflichtspalte fehlt: ${fehlend.join(', ')}. Gefundene Überschriften: ${kopf.join(', ')}`,
    );
  }

  const wert = (zeile: string[], feld: PersonFeld): string | null => {
    const i = spalte[feld];
    if (i === undefined) return null;
    const v = (zeile[i] ?? '').trim();
    return v === '' ? null : v;
  };

  const personen: PersonDaten[] = [];
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const unbekannt = new Set<string>();
  const ids = new Set<number>();
  let ohneVereinsadresse = 0;

  for (const { record: zeile, info } of datensaetze.slice(1)) {
    if (zeile.every((z) => !z.trim())) continue;
    const nr = info.lines;
    const idText = wert(zeile, 'clubdesk_id');
    if (!idText || !/^\d+$/.test(idText) || Number(idText) < 1 || Number(idText) > 2_147_483_647) {
      fehler.push(`Zeile ${nr}: ID fehlt oder ist keine ganze Zahl («${idText ?? ''}»).`);
      continue;
    }
    const id = Number(idText);
    if (ids.has(id)) {
      fehler.push(`Zeile ${nr}: ID ${id} kommt doppelt vor.`);
      continue;
    }
    ids.add(id);

    const gebText = wert(zeile, 'geburtsdatum');
    const geburtsdatum = gebText ? leseDatum(gebText) : null;
    if (gebText && !geburtsdatum) hinweise.push(`Zeile ${nr}: Geburtsdatum «${gebText}» ist ungültig. Das Feld bleibt leer.`);

    const rangText = wert(zeile, 'rang');
    let rangId: number | null = null;
    if (rangText) {
      rangId = raenge.get(rangText) ?? null;
      // Regel 16.2.5: Unbekannter Rang steht in einer Liste. rang_id bleibt leer.
      if (rangId === null) unbekannt.add(rangText);
    }

    // Regel 16.1: Nur Adressen mit @web.kkb.ch. Sonst bleibt email leer.
    const mail = wert(zeile, 'email');
    const email = mail && mail.toLowerCase().endsWith(VEREINS_DOMAIN) ? mail : null;
    if (!email) ohneVereinsadresse++;

    personen.push({
      clubdesk_id: id,
      vorname: wert(zeile, 'vorname'),
      nachname: wert(zeile, 'nachname'),
      geburtsdatum,
      rang_id: rangId,
      strasse: wert(zeile, 'strasse'),
      adresszusatz: wert(zeile, 'adresszusatz'),
      plz: wert(zeile, 'plz'),
      ort: wert(zeile, 'ort'),
      telefon: wert(zeile, 'telefon'),
      telefon_privat: wert(zeile, 'telefon_privat'),
      email,
      essenseinschraenkung: wert(zeile, 'essenseinschraenkung'),
    });
  }
  return { personen, fehler, hinweise, unbekannteRaenge: [...unbekannt].sort(), ohneVereinsadresse };
}

export interface Aenderung {
  feld: string;
  alt: string | null;
  neu: string | null;
}

export interface Entfernt {
  clubdesk_id: number;
  name: string;
  einsaetze: string[];
}

export interface Vorschau {
  fehler: string[];
  hinweise: string[];
  neu: PersonDaten[];
  geaendert: { clubdesk_id: number; name: string; wieder: boolean; aenderungen: Aenderung[] }[];
  unveraendert: number;
  /** Regel 16.2.3: entfernt mit künftigen Anmeldungen (W_AUSTRITT). */
  entferntMitZukunft: Entfernt[];
  /** Regel 16.2.3: entfernt ohne künftige Anmeldungen (löschbar nach Rückfrage). */
  entferntOhneZukunft: Entfernt[];
  unbekannteRaenge: string[];
  ohneVereinsadresse: number;
  bestand: number;
  /** Regel 16.2.4: mehr als max(5, 10 %) entfernt. */
  vieleAustritte: boolean;
  personen: PersonDaten[];
}

function name(p: { vorname: string | number | null; nachname: string | number | null }): string {
  return [p.vorname, p.nachname].filter(Boolean).join(' ');
}

/** Regel 16.2: Vorschau berechnen. Ändert nichts. */
export async function erstelleVorschau(db: Db, daten: Buffer): Promise<Vorschau> {
  const rangZeilen = await alle<{ id: number; name: string }>(db, 'SELECT id, name FROM rang');
  const rangNamen = new Map(rangZeilen.map((r) => [r.name, r.id]));
  const rangVonId = new Map(rangZeilen.map((r) => [r.id, r.name]));
  const csv = leseClubdeskCsv(daten, rangNamen);
  const bestehend = await alle<PersonDaten & { geloescht_am: string | null }>(db, 'SELECT * FROM person');
  const proId = new Map(bestehend.map((p) => [p.clubdesk_id, p]));
  const inCsv = new Set(csv.personen.map((p) => p.clubdesk_id));

  const v: Vorschau = {
    fehler: csv.fehler,
    hinweise: csv.hinweise,
    neu: [],
    geaendert: [],
    unveraendert: 0,
    entferntMitZukunft: [],
    entferntOhneZukunft: [],
    unbekannteRaenge: csv.unbekannteRaenge,
    ohneVereinsadresse: csv.ohneVereinsadresse,
    bestand: bestehend.filter((p) => !p.geloescht_am).length,
    vieleAustritte: false,
    personen: csv.personen,
  };

  const anzeige = (feld: Datenfeld, w: string | number | null): string | null => {
    if (w === null || w === undefined) return null;
    if (feld === 'rang_id') return rangVonId.get(Number(w)) ?? null;
    return String(w);
  };

  for (const p of csv.personen) {
    const alt = proId.get(p.clubdesk_id);
    if (!alt) {
      v.neu.push(p);
      continue;
    }
    const aenderungen: Aenderung[] = [];
    for (const f of DATENFELDER) {
      const a = alt[f] === undefined ? null : alt[f];
      const n = p[f];
      if (String(a ?? '') !== String(n ?? '')) aenderungen.push({ feld: FELD_TEXT[f], alt: anzeige(f, a), neu: anzeige(f, n) });
    }
    if (aenderungen.length || alt.geloescht_am) {
      v.geaendert.push({ clubdesk_id: p.clubdesk_id, name: name(p), wieder: !!alt.geloescht_am, aenderungen });
    } else v.unveraendert++;
  }

  // Regel 16.2.2: entfernt = hat Personendaten in der Datenbank, fehlt in der CSV.
  const entfernt = bestehend.filter((p) => !p.geloescht_am && !inCsv.has(p.clubdesk_id));
  if (entfernt.length) {
    const zukunft = await alle<{ person_id: number; einsatz: string; schicht: string; anzahl: number }>(
      db,
      `SELECT a.person_id, e.name AS einsatz, s.name AS schicht, (SELECT COUNT(*) FROM schicht x WHERE x.einsatz_id = e.id) AS anzahl
         FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
        WHERE a.person_id IN (?) AND a.status IN ('angemeldet','bestaetigt','unsicher','nachricht_gesendet') AND s.end_zeit > ?
        ORDER BY s.start_zeit`,
      [entfernt.map((p) => p.clubdesk_id), jetztIso()],
    );
    const proPerson = new Map<number, string[]>();
    for (const z of zukunft) {
      if (!proPerson.has(z.person_id)) proPerson.set(z.person_id, []);
      proPerson.get(z.person_id)!.push(Number(z.anzahl) === 1 ? z.einsatz : `${z.einsatz} – ${z.schicht}`);
    }
    for (const p of entfernt) {
      const e = { clubdesk_id: p.clubdesk_id, name: name(p), einsaetze: proPerson.get(p.clubdesk_id) ?? [] };
      (e.einsaetze.length ? v.entferntMitZukunft : v.entferntOhneZukunft).push(e);
    }
  }
  const schwelle = Math.max(5, v.bestand * 0.1);
  v.vieleAustritte = entfernt.length > schwelle;
  return v;
}

/**
 * Regel 16.3.3: Personendaten löschen. Zeile und ID bleiben. Die Anmeldungen zeigen
 * «Gelöschte Person <ID>». E-Mail und Bemerkung der Anmeldungen leert das Tool.
 * Entscheid Yann: Das Statusprotokoll bleibt. Bemerkungen sowie Name oder Mail vor einer
 * Zuordnung leert das Tool auch im Protokoll.
 */
export async function loeschePersonendaten(c: Db, id: number, benutzerId: number | null): Promise<void> {
  const zeit = jetztIso();
  await schreibe(
    c,
    `UPDATE person SET vorname = NULL, nachname = NULL, geburtsdatum = NULL, rang_id = NULL, strasse = NULL,
       adresszusatz = NULL, plz = NULL, ort = NULL, telefon = NULL, telefon_privat = NULL, email = NULL,
       essenseinschraenkung = NULL, geloescht_am = ? WHERE clubdesk_id = ?`,
    [zeit, id],
  );
  const anmeldungen = await alle<{ id: number }>(c, 'SELECT id FROM anmeldung WHERE person_id = ?', [id]);
  if (!anmeldungen.length) return;
  const ids = anmeldungen.map((a) => a.id);
  await schreibe(c, 'UPDATE anmeldung SET name_text = ?, email_text = NULL, bemerkung = NULL, geaendert_am = ? WHERE person_id = ?', [
    `Gelöschte Person ${id}`, zeit, id,
  ]);
  await schreibe(
    c,
    "UPDATE status_log SET alt_wert = NULL, neu_wert = NULL WHERE anmeldung_id IN (?) AND aktion IN ('bemerkung','zugeordnet')",
    [ids],
  );
  for (const aid of ids) await schreibeLog(c, aid, benutzerId, 'personendaten_geloescht', null, null, zeit);
}

export interface AnwendenOptionen {
  /** Personen ohne künftige Anmeldungen, deren Daten gelöscht werden sollen (Häkchen). */
  loeschen: number[];
  /** Antwort auf die Rückfrage «Personendaten von n Personen löschen?». */
  loeschenBestaetigt: boolean;
  /** Kästchen beim roten Banner «Ungewöhnlich viele Austritte». */
  austritteBestaetigt: boolean;
  dateiname: string | null;
}

export interface Zusammenfassung {
  neu: number;
  geaendert: number;
  geloescht: number;
  unveraendert: number;
  unzugeordnet: number;
}

export type AnwendenErgebnis =
  | { angewendet: true; zusammenfassung: Zusammenfassung }
  | { angewendet: false; grund: string; vorschau: Vorschau };

/** Regel 16.3: Import in einer einzigen Transaktion anwenden. */
export async function wendeImportAn(db: Db, daten: Buffer, o: AnwendenOptionen, benutzerId: number | null): Promise<AnwendenErgebnis> {
  return transaktion(db, async (c) => {
    const v = await erstelleVorschau(c, daten);
    if (v.fehler.length) return { angewendet: false, grund: 'Die Datei hat Fehler.', vorschau: v };
    // Regel 16.2.4: Bei vielen Austritten muss das Kästchen angekreuzt sein.
    if (v.vieleAustritte && !o.austritteBestaetigt) {
      return { angewendet: false, grund: 'Bestätige zuerst die ungewöhnlich vielen Austritte.', vorschau: v };
    }
    // Nur Personen ohne künftige Anmeldungen sind löschbar (T24).
    const erlaubt = new Set(v.entferntOhneZukunft.map((e) => e.clubdesk_id));
    const loeschen = [...new Set(o.loeschen)].filter((id) => erlaubt.has(id));
    // Entscheid Yann: Ohne Bestätigung der Löschung zeigt das Tool die Vorschau erneut und ändert nichts.
    if (loeschen.length && !o.loeschenBestaetigt) {
      return { angewendet: false, grund: `Bestätige die Löschung der Personendaten von ${loeschen.length} Personen.`, vorschau: v };
    }

    const zeit = jetztIso();
    const geaendertIds = new Set(v.geaendert.map((g) => g.clubdesk_id));
    const neuIds = new Set(v.neu.map((n) => n.clubdesk_id));
    for (const p of v.personen) {
      const werte = DATENFELDER.map((f) => p[f]);
      if (neuIds.has(p.clubdesk_id)) {
        await schreibe(
          c,
          `INSERT INTO person (clubdesk_id, ${DATENFELDER.join(', ')}, importiert_am, geloescht_am)
           VALUES (?, ${DATENFELDER.map(() => '?').join(', ')}, ?, NULL)`,
          [p.clubdesk_id, ...werte, zeit],
        );
      } else if (geaendertIds.has(p.clubdesk_id)) {
        // Regel 16.3.2: Kommt eine gelöschte Person wieder vor, füllt das Tool die Felder.
        await schreibe(
          c,
          `UPDATE person SET ${DATENFELDER.map((f) => `${f} = ?`).join(', ')}, importiert_am = ?, geloescht_am = NULL WHERE clubdesk_id = ?`,
          [...werte, zeit, p.clubdesk_id],
        );
      }
    }
    for (const id of loeschen) await loeschePersonendaten(c, id, benutzerId);

    await schreibe(c, 'INSERT INTO import_log (zeit, benutzer_id, dateiname, neu, geaendert, entfernt) VALUES (?, ?, ?, ?, ?, ?)', [
      zeit, benutzerId, o.dateiname, v.neu.length, v.geaendert.length, loeschen.length,
    ]);
    const unz = await eine<{ n: number }>(c, 'SELECT COUNT(*) AS n FROM anmeldung WHERE person_id IS NULL');
    return {
      angewendet: true,
      zusammenfassung: {
        neu: v.neu.length,
        geaendert: v.geaendert.length,
        geloescht: loeschen.length,
        unveraendert: v.unveraendert,
        unzugeordnet: Number(unz?.n ?? 0),
      },
    };
  });
}

export async function letzteImporte(db: Db): Promise<{ zeit: string; benutzer: string | null; dateiname: string | null; neu: number; geaendert: number; entfernt: number }[]> {
  return alle(
    db,
    'SELECT i.zeit, b.name AS benutzer, i.dateiname, i.neu, i.geaendert, i.entfernt FROM import_log i LEFT JOIN benutzer b ON b.id = i.benutzer_id ORDER BY i.id DESC LIMIT 10',
  );
}
