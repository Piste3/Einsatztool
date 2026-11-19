// Listen für die Oberfläche: Anrufliste (14.3), Rückmeldungen, Startseite «Zu tun».
import { alle, eine, type Db } from '../db/db.js';
import type { Status } from './eingabe.js';
import { ladeSchicht } from './schicht.js';
import { passtZuSchicht, warnungenFuerSchichten } from './warnungen.js';
import { zahlenFuerSchichten, type SchichtZahlen } from './zaehlung.js';
import { alterAm, isoUtc, jetztIso, lokalesDatum } from './zeit.js';

export interface PersonKurz {
  clubdesk_id: number;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: string | null;
  rang_name: string | null;
  rang_reihenfolge: number | null;
  telefon: string | null;
  telefon_privat: string | null;
  email: string | null;
  essenseinschraenkung: string | null;
}

const PERSON_KURZ = `SELECT p.clubdesk_id, p.vorname, p.nachname, p.geburtsdatum, r.name AS rang_name, r.reihenfolge AS rang_reihenfolge,
  p.telefon, p.telefon_privat, p.email, p.essenseinschraenkung
  FROM person p LEFT JOIN rang r ON r.id = p.rang_id WHERE p.geloescht_am IS NULL`;

/** Sortierung: tiefster Rang zuerst, im Rang nach Name (Abschnitt 3 des Auftrags). */
export function nachRangTiefZuerst<T extends { rang_reihenfolge: number | null; nachname: string | null; vorname: string | null }>(a: T, b: T): number {
  const ra = a.rang_reihenfolge ?? -Infinity;
  const rb = b.rang_reihenfolge ?? -Infinity;
  if (ra !== rb) return ra - rb;
  return `${a.nachname ?? ''} ${a.vorname ?? ''}`.localeCompare(`${b.nachname ?? ''} ${b.vorname ?? ''}`, 'de');
}

export interface AnruflisteZeile extends PersonKurz {
  alter: number | null;
  passt: boolean;
  anmeldung_id: number | null;
  status: Status | null;
  bemerkung: string | null;
}

/**
 * Regel 14.3: Personen ohne Eintrag in dieser Schicht sowie Personen mit «unsicher» oder
 * «Nachricht gesendet». Personen, die Mindestalter oder Mindestrang nicht erfüllen, sind ausgeblendet
 * (Schalter zum Einblenden).
 */
export async function anrufliste(db: Db, schichtId: number, alleZeigen: boolean): Promise<{ zeilen: AnruflisteZeile[]; ausgeblendet: number }> {
  const s = await ladeSchicht(db, schichtId);
  const personen = await alle<PersonKurz>(db, PERSON_KURZ);
  const eintraege = await alle<{ id: number; person_id: number; status: Status; bemerkung: string | null }>(
    db,
    'SELECT id, person_id, status, bemerkung FROM anmeldung WHERE schicht_id = ? AND person_id IS NOT NULL',
    [schichtId],
  );
  const proPerson = new Map(eintraege.map((e) => [e.person_id, e]));
  const stichtag = lokalesDatum(s.start_zeit);
  const zeilen: AnruflisteZeile[] = [];
  let ausgeblendet = 0;
  for (const p of personen) {
    const e = proPerson.get(p.clubdesk_id);
    if (e && e.status !== 'unsicher' && e.status !== 'nachricht_gesendet') continue;
    const passt = passtZuSchicht(p, s);
    if (!passt && !alleZeigen) {
      ausgeblendet++;
      continue;
    }
    zeilen.push({
      ...p,
      alter: p.geburtsdatum ? alterAm(p.geburtsdatum, stichtag) : null,
      passt,
      anmeldung_id: e?.id ?? null,
      status: e?.status ?? null,
      bemerkung: e?.bemerkung ?? null,
    });
  }
  zeilen.sort(nachRangTiefZuerst);
  return { zeilen, ausgeblendet };
}

export interface RueckmeldungSchicht {
  id: number;
  name: string;
  einsatz_name: string;
  einsatz_id: number;
  start_zeit: string;
  end_zeit: string;
  publiziert: number;
  min_alter: number | null;
  min_rang_reihenfolge: number | null;
  soll_anzahl: number | null;
  /** Teilnehmende nach der Zählung der Schicht (13.6), für Ist / Soll im Kopf. */
  teilnehmende: number;
  summe: { an: number; ab: number; unsicher: number; offen: number };
}

export interface RueckmeldungZelle {
  status: Status | null;
  geaendert_am: string | null;
  kanal: string | null;
  passt: boolean;
  /**
   * Nur bei einem Feld ohne Eintrag: Die Person ist in einer anderen Schicht desselben Einsatzes an
   * (angemeldet oder bestätigt). «gleich» = die Zeiten überschneiden sich, «moeglich» = nicht.
   */
  andere: 'gleich' | 'moeglich' | null;
}

export interface RueckmeldungOptionen {
  monate: 1 | 3 | 6 | 12;
  nurOffen: boolean;
  unpublizierte: boolean;
  suche: string;
  sortierung: 'rang' | 'name';
}

/**
 * Seite «Rückmeldungen»: Personen × kommende Schichten.
 * An = angemeldet oder bestätigt, Ab = abgemeldet, Unsicher = unsicher,
 * Offen = passende Person ohne Eintrag oder mit «Nachricht gesendet».
 */
export async function rueckmeldungen(db: Db, o: RueckmeldungOptionen): Promise<{
  schichten: RueckmeldungSchicht[];
  personen: (PersonKurz & { zellen: RueckmeldungZelle[] })[];
}> {
  const jetzt = jetztIso();
  const bis = new Date();
  bis.setMonth(bis.getMonth() + o.monate);
  const schichten = await alle<RueckmeldungSchicht>(
    db,
    `SELECT s.id, s.name, e.name AS einsatz_name, e.id AS einsatz_id, s.start_zeit, s.end_zeit, s.publiziert, s.min_alter, s.soll_anzahl,
            r.reihenfolge AS min_rang_reihenfolge
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id LEFT JOIN rang r ON r.id = s.min_rang_id
      WHERE s.end_zeit > ? AND s.start_zeit < ? ${o.unpublizierte ? '' : 'AND s.publiziert = 1'}
      ORDER BY s.start_zeit, s.id`,
    [jetzt, isoUtc(bis)],
  );
  const zahlen = await zahlenFuerSchichten(db, schichten.map((s) => s.id));
  for (const s of schichten) {
    s.summe = { an: 0, ab: 0, unsicher: 0, offen: 0 };
    s.teilnehmende = zahlen.get(s.id)?.teilnehmende ?? 0;
  }
  let personen = await alle<PersonKurz>(db, PERSON_KURZ);
  const eintraege = schichten.length
    ? await alle<{ schicht_id: number; person_id: number; status: Status; geaendert_am: string; kanal: string }>(
        db,
        'SELECT schicht_id, person_id, status, geaendert_am, kanal FROM anmeldung WHERE schicht_id IN (?) AND person_id IS NOT NULL',
        [schichten.map((s) => s.id)],
      )
    : [];
  const key = (sid: number, pid: number) => `${sid}:${pid}`;
  const proZelle = new Map(eintraege.map((e) => [key(e.schicht_id, e.person_id), e]));

  const suche = o.suche.trim().toLowerCase();
  if (suche) personen = personen.filter((p) => `${p.vorname ?? ''} ${p.nachname ?? ''}`.toLowerCase().includes(suche));

  const zeilen = personen.map((p) => {
    const zellen = schichten.map((s) => {
      const e = proZelle.get(key(s.id, p.clubdesk_id));
      const passt = passtZuSchicht(p, s);
      const status = e?.status ?? null;
      if (status === 'angemeldet' || status === 'bestaetigt') s.summe.an++;
      else if (status === 'abgemeldet') s.summe.ab++;
      else if (status === 'unsicher') s.summe.unsicher++;
      else if (passt) s.summe.offen++;
      let andere: RueckmeldungZelle['andere'] = null;
      if (!status) {
        for (const x of schichten) {
          if (x.id === s.id || x.einsatz_id !== s.einsatz_id) continue;
          const st = proZelle.get(key(x.id, p.clubdesk_id))?.status;
          if (st !== 'angemeldet' && st !== 'bestaetigt') continue;
          if (x.start_zeit < s.end_zeit && s.start_zeit < x.end_zeit) { andere = 'gleich'; break; }
          andere = 'moeglich';
        }
      }
      return { status, geaendert_am: e?.geaendert_am ?? null, kanal: e?.kanal ?? null, passt, andere };
    });
    return { ...p, zellen };
  });
  let ergebnis = zeilen;
  if (o.nurOffen) {
    ergebnis = zeilen.filter((z) => z.zellen.some((c) => c.passt && (c.status === null || c.status === 'nachricht_gesendet')));
  }
  if (o.sortierung === 'name') {
    ergebnis.sort((a, b) => `${a.nachname ?? ''} ${a.vorname ?? ''}`.localeCompare(`${b.nachname ?? ''} ${b.vorname ?? ''}`, 'de'));
  } else ergebnis.sort(nachRangTiefZuerst);
  return { schichten, personen: ergebnis };
}

export interface StartSchicht {
  id: number;
  name: string;
  start_zeit: string;
  end_zeit: string;
  soll_anzahl: number | null;
  publiziert: number;
  zahlen: SchichtZahlen;
  warnungen: number;
}

export interface StartEinsatz {
  id: number;
  name: string;
  ort: string | null;
  schichten: StartSchicht[];
  unbestaetigt: number;
  warnungen: number;
}

export interface StartUebersicht {
  unbestaetigt: number;
  unbekannt: number;
  unterSoll: number;
  mitWarnungen: number;
  einsaetze: StartEinsatz[];
}

/** Zähler für die Seitenleiste: unbestätigte und unbekannte Anmeldungen in kommenden Schichten. */
export async function zaehlerSeitenleiste(db: Db): Promise<{ unbestaetigt: number; unbekannt: number }> {
  const z = await eine<{ u: number; k: number }>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id WHERE a.status = 'angemeldet' AND s.end_zeit > ?) AS u,
       (SELECT COUNT(*) FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id WHERE a.person_id IS NULL AND a.status <> 'abgemeldet' AND s.end_zeit > ?) AS k`,
    [jetztIso(), jetztIso()],
  );
  return { unbestaetigt: Number(z?.u ?? 0), unbekannt: Number(z?.k ?? 0) };
}

/** Startseite «Zu tun»: Kacheln und kommende Einsätze mit allen Schichten. */
export async function startUebersicht(db: Db): Promise<StartUebersicht> {
  const jetzt = jetztIso();
  const schichten = await alle<any>(
    db,
    `SELECT s.id, s.name, s.start_zeit, s.end_zeit, s.soll_anzahl, s.publiziert, s.einsatz_id, e.name AS einsatz_name, e.ort AS einsatz_ort
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id
      WHERE s.einsatz_id IN (SELECT einsatz_id FROM schicht GROUP BY einsatz_id HAVING MAX(end_zeit) > ?)
      ORDER BY s.start_zeit, s.id`,
    [jetzt],
  );
  const ids = schichten.map((s) => s.id);
  const zahlen = await zahlenFuerSchichten(db, ids);
  const warnungen = await warnungenFuerSchichten(db, ids);
  const zaehler = await zaehlerSeitenleiste(db);
  const einsaetze = new Map<number, StartEinsatz>();
  let unterSoll = 0;
  let mitWarnungen = 0;
  for (const s of schichten) {
    if (!einsaetze.has(s.einsatz_id)) {
      einsaetze.set(s.einsatz_id, { id: s.einsatz_id, name: s.einsatz_name, ort: s.einsatz_ort, schichten: [], unbestaetigt: 0, warnungen: 0 });
    }
    const z = zahlen.get(s.id)!;
    const w = warnungen.get(s.id)!;
    const anzahlW = w.schicht.length + [...w.anmeldungen.values()].reduce((n, l) => n + l.length, 0);
    const e = einsaetze.get(s.einsatz_id)!;
    e.schichten.push({ id: s.id, name: s.name, start_zeit: s.start_zeit, end_zeit: s.end_zeit, soll_anzahl: s.soll_anzahl, publiziert: s.publiziert, zahlen: z, warnungen: anzahlW });
    e.unbestaetigt += z.unbestaetigt;
    e.warnungen += anzahlW;
    if (s.end_zeit > jetzt) {
      if (s.soll_anzahl !== null && z.teilnehmende < s.soll_anzahl) unterSoll++;
      if (anzahlW > 0) mitWarnungen++;
    }
  }
  return { ...zaehler, unterSoll, mitWarnungen, einsaetze: [...einsaetze.values()] };
}

export interface UnbekannterEintrag {
  id: number;
  name_text: string;
  email_text: string | null;
  bemerkung: string | null;
  status: Status;
  erstellt_am: string;
  schicht_id: number;
  schicht: string;
  einsatz: string;
  start_zeit: string;
}

/** Regel 14.6.2: alle unzugeordneten Einträge. */
export async function unbekannteEintraege(db: Db): Promise<UnbekannterEintrag[]> {
  return alle<UnbekannterEintrag>(
    db,
    `SELECT a.id, a.name_text, a.email_text, a.bemerkung, a.status, a.erstellt_am, s.id AS schicht_id, s.name AS schicht,
            e.name AS einsatz, s.start_zeit
       FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
      WHERE a.person_id IS NULL ORDER BY s.start_zeit, a.id`,
  );
}

/**
 * Regel 14.6.3: Vorschläge für die Zuordnung. Personen mit gleichem Nachnamen oder Vornamen zuerst.
 * Bei «Mehrdeutig» die genannten Clubdesk-IDs vorab.
 */
export async function zuordnungsVorschlaege(db: Db, e: { name_text: string; bemerkung: string | null }, suche: string): Promise<PersonKurz[]> {
  const personen = await alle<PersonKurz>(db, PERSON_KURZ);
  const teile = e.name_text.toLowerCase().split(/\s+/).filter(Boolean);
  const mehrdeutig = new Set(
    [...(e.bemerkung ?? '').matchAll(/Mehrdeutig: Clubdesk-IDs ([\d, ]+)/g)].flatMap((m) => m[1].split(',').map((x) => Number(x.trim()))),
  );
  const q = suche.trim().toLowerCase();
  const wertung = (p: PersonKurz): number => {
    if (mehrdeutig.has(p.clubdesk_id)) return 0;
    const v = (p.vorname ?? '').toLowerCase();
    const n = (p.nachname ?? '').toLowerCase();
    if (teile.includes(n)) return 1;
    if (teile.includes(v)) return 2;
    return 3;
  };
  return personen
    .filter((p) => (q ? `${p.vorname ?? ''} ${p.nachname ?? ''}`.toLowerCase().includes(q) : wertung(p) < 3))
    .sort((a, b) => wertung(a) - wertung(b) || `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, 'de'))
    .slice(0, 30);
}

export interface PersonEintrag {
  id: number;
  schicht_id: number;
  schicht: string;
  einsatz: string;
  einsatz_id: number;
  start_zeit: string;
  end_zeit: string;
  status: Status;
  rolle: string | null;
  kanal: string;
  bemerkung: string | null;
}

/** Personenseite: kommende Einträge, offene Schichten (nicht gefragt) und vergangene Einträge. */
export async function personUebersicht(db: Db, personId: number): Promise<{
  kommend: PersonEintrag[];
  vergangen: PersonEintrag[];
  offen: { id: number; name: string; einsatz: string; einsatz_id: number; start_zeit: string; end_zeit: string; publiziert: number }[];
}> {
  const jetzt = jetztIso();
  const eintraege = await alle<PersonEintrag>(
    db,
    `SELECT a.id, s.id AS schicht_id, s.name AS schicht, e.name AS einsatz, e.id AS einsatz_id, s.start_zeit, s.end_zeit,
            a.status, a.rolle, a.kanal, a.bemerkung
       FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
      WHERE a.person_id = ? ORDER BY s.start_zeit`,
    [personId],
  );
  const offen = await alle<any>(
    db,
    `SELECT s.id, s.name, e.name AS einsatz, e.id AS einsatz_id, s.start_zeit, s.end_zeit, s.publiziert
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id
      WHERE s.end_zeit > ? AND NOT EXISTS (SELECT 1 FROM anmeldung a WHERE a.schicht_id = s.id AND a.person_id = ?)
      ORDER BY s.start_zeit`,
    [jetzt, personId],
  );
  return {
    kommend: eintraege.filter((e) => e.end_zeit > jetzt),
    vergangen: eintraege.filter((e) => e.end_zeit <= jetzt).reverse(),
    offen,
  };
}
