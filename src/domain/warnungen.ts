// Warnungen (13.7). Eine Warnung hat einen Code und einen Text. Sie sperrt nichts.
import { alle, type Db } from '../db/db.js';
import { alterAm, datumChVonIso, lokalesDatum, jetztIso, zeitraumText } from './zeit.js';
import { terminTitel } from './ics.js';
import { abgleichFuerSchicht, type AbgleichErgebnis } from './ical-abgleich.js';

export interface Warnung {
  code: string;
  text: string;
}

export interface SchichtWarnungen {
  schicht: Warnung[];
  anmeldungen: Map<number, Warnung[]>;
  abgleich: AbgleichErgebnis;
}

interface SchichtInfo {
  id: number;
  name: string;
  start_zeit: string;
  end_zeit: string;
  min_alter: number | null;
  min_rang_id: number | null;
  min_rang_reihenfolge: number | null;
  min_rang_name: string | null;
  einsatz_name: string;
  anzahl_schichten: number;
}

/** Regel W_ALTER: Alter am Starttag kleiner als Mindestalter. Ohne Geburtsdatum keine Warnung (Entscheid Yann). */
export function pruefeAlter(geburtsdatum: string | null, minAlter: number | null, startIso: string): Warnung | null {
  if (minAlter === null || minAlter === undefined || !geburtsdatum) return null;
  if (alterAm(geburtsdatum, lokalesDatum(startIso)) < minAlter) {
    return { code: 'W_ALTER', text: `Jünger als das Mindestalter (${minAlter}).` };
  }
  return null;
}

/** Regel W_RANG: Rang niedriger als der Mindestrang, oder kein Rang. */
export function pruefeRang(rangReihenfolge: number | null, minRangReihenfolge: number | null): Warnung | null {
  if (minRangReihenfolge === null || minRangReihenfolge === undefined) return null;
  if (rangReihenfolge === null || rangReihenfolge === undefined || Number(rangReihenfolge) < Number(minRangReihenfolge)) {
    return { code: 'W_RANG', text: 'Rang unter dem Mindestrang.' };
  }
  return null;
}

/**
 * Passt eine Person zu Mindestalter und Mindestrang? Für Anrufliste und Rückmeldungen.
 * Entscheid Yann: Ohne Geburtsdatum (bei Mindestalter) oder ohne Rang (bei Mindestrang) = nicht passend.
 */
export function passtZuSchicht(
  p: { geburtsdatum: string | null; rang_reihenfolge: number | null },
  s: { min_alter: number | null; min_rang_reihenfolge: number | null; start_zeit: string },
): boolean {
  if (s.min_alter !== null && s.min_alter !== undefined) {
    if (!p.geburtsdatum) return false;
    if (alterAm(p.geburtsdatum, lokalesDatum(s.start_zeit)) < s.min_alter) return false;
  }
  if (s.min_rang_reihenfolge !== null && s.min_rang_reihenfolge !== undefined) {
    if (p.rang_reihenfolge === null || p.rang_reihenfolge === undefined) return false;
    if (Number(p.rang_reihenfolge) < Number(s.min_rang_reihenfolge)) return false;
  }
  return true;
}

/** Warnungen für mehrere Schichten auf einmal (schnell auch bei 500 Personen). */
export async function warnungenFuerSchichten(db: Db, schichtIds: number[]): Promise<Map<number, SchichtWarnungen>> {
  const ergebnis = new Map<number, SchichtWarnungen>();
  if (!schichtIds.length) return ergebnis;
  const jetzt = jetztIso();

  const schichten = await alle<SchichtInfo>(
    db,
    `SELECT s.id, s.name, s.start_zeit, s.end_zeit, s.min_alter, s.min_rang_id, r.reihenfolge AS min_rang_reihenfolge,
            r.name AS min_rang_name, e.name AS einsatz_name,
            (SELECT COUNT(*) FROM schicht x WHERE x.einsatz_id = s.einsatz_id) AS anzahl_schichten
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id LEFT JOIN rang r ON r.id = s.min_rang_id
      WHERE s.id IN (?)`,
    [schichtIds],
  );
  const proSchicht = new Map<number, SchichtInfo>();
  for (const s of schichten) {
    proSchicht.set(s.id, s);
    // Regel 17.4.3: Abgleich nur für Schichten, deren Ende in der Zukunft liegt.
    const abgleich: AbgleichErgebnis =
      s.end_zeit > jetzt ? abgleichFuerSchicht(terminTitel(s), s.start_zeit, s.end_zeit) : { status: 'unbekannt' };
    const w: Warnung[] = [];
    if (abgleich.status === 'fehlt') w.push({ code: 'W_TERMIN_FEHLT', text: 'Kein Clubdesk-Termin gefunden.' });
    if (abgleich.status === 'zeit_abweicht' && abgleich.termin) {
      w.push({
        code: 'W_TERMIN_ZEIT',
        text: `Zeiten in Clubdesk weichen ab (${zeitraumText(abgleich.termin.start, abgleich.termin.ende)}).`,
      });
    }
    ergebnis.set(s.id, { schicht: w, anmeldungen: new Map(), abgleich });
  }

  // W_ROLLE_FEHLT: bestätigte Personen mit Rolle sind weniger als die benötigte Anzahl.
  const rollen = await alle<{ schicht_id: number; rolle: string; soll: number; ist: number }>(
    db,
    `SELECT sr.schicht_id, sr.rolle, sr.anzahl AS soll,
            (SELECT COUNT(*) FROM anmeldung a WHERE a.schicht_id = sr.schicht_id AND a.rolle = sr.rolle AND a.status = 'bestaetigt') AS ist
       FROM schicht_rolle sr WHERE sr.schicht_id IN (?)`,
    [schichtIds],
  );
  for (const r of rollen) {
    const fehlen = Number(r.soll) - Number(r.ist);
    if (fehlen > 0) {
      ergebnis.get(r.schicht_id)!.schicht.push({ code: 'W_ROLLE_FEHLT', text: `Es fehlen ${fehlen} ${r.rolle}.` });
    }
  }

  // Warnungen je Eintrag. Abgemeldete Einträge erhalten keine Warnung.
  const eintraege = await alle<{
    id: number;
    schicht_id: number;
    person_id: number | null;
    status: string;
    geburtsdatum: string | null;
    rang_reihenfolge: number | null;
    geloescht_am: string | null;
  }>(
    db,
    `SELECT a.id, a.schicht_id, a.person_id, a.status, p.geburtsdatum, r.reihenfolge AS rang_reihenfolge, p.geloescht_am
       FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
      WHERE a.schicht_id IN (?) AND a.status <> 'abgemeldet'`,
    [schichtIds],
  );
  const hinzu = (sid: number, aid: number, w: Warnung) => {
    const m = ergebnis.get(sid)!.anmeldungen;
    if (!m.has(aid)) m.set(aid, []);
    m.get(aid)!.push(w);
  };
  for (const a of eintraege) {
    const s = proSchicht.get(a.schicht_id)!;
    if (a.person_id === null) {
      hinzu(a.schicht_id, a.id, { code: 'W_UNBEKANNT', text: 'Person nicht in Clubdesk-Daten.' });
      continue;
    }
    if (a.geloescht_am) continue;
    const wa = pruefeAlter(a.geburtsdatum, s.min_alter, s.start_zeit);
    if (wa) hinzu(a.schicht_id, a.id, wa);
    const wr = pruefeRang(a.rang_reihenfolge, s.min_rang_reihenfolge);
    if (wr) hinzu(a.schicht_id, a.id, wr);
  }

  // W_UEBERLAPP: Die Person hat in einer anderen Schicht einen Eintrag mit angemeldet oder bestätigt,
  // und die Zeiten überlappen (a.start < b.ende UND b.start < a.ende). Ende = Start ist erlaubt.
  // Entscheid Yann: Nur der Status des anderen Eintrags zählt.
  const ueberlapp = await alle<{ id: number; schicht_id: number; s2_name: string; e2_name: string; s2_start: string }>(
    db,
    `SELECT a.id, a.schicht_id, s2.name AS s2_name, e2.name AS e2_name, s2.start_zeit AS s2_start
       FROM anmeldung a
       JOIN schicht s ON s.id = a.schicht_id
       JOIN anmeldung b ON b.person_id = a.person_id AND b.id <> a.id AND b.status IN ('angemeldet','bestaetigt')
       JOIN schicht s2 ON s2.id = b.schicht_id
       JOIN einsatz e2 ON e2.id = s2.einsatz_id
      WHERE a.schicht_id IN (?) AND a.person_id IS NOT NULL AND a.status <> 'abgemeldet'
        AND s.start_zeit < s2.end_zeit AND s2.start_zeit < s.end_zeit`,
    [schichtIds],
  );
  for (const u of ueberlapp) {
    const name = u.e2_name === u.s2_name ? u.e2_name : `${u.e2_name} – ${u.s2_name}`;
    hinzu(u.schicht_id, u.id, { code: 'W_UEBERLAPP', text: `Nimmt gleichzeitig an Schicht «${name}» (${datumChVonIso(u.s2_start)}) teil.` });
  }
  return ergebnis;
}

/** Warnungen einer Schicht (13.7). */
export async function warnungenFuerSchicht(db: Db, schichtId: number): Promise<SchichtWarnungen> {
  const m = await warnungenFuerSchichten(db, [schichtId]);
  return m.get(schichtId) ?? { schicht: [], anmeldungen: new Map(), abgleich: { status: 'unbekannt' } };
}

/** Warnungen eines Eintrags (13.7). */
export async function warnungenFuerAnmeldung(db: Db, anmeldungId: number): Promise<Warnung[]> {
  const z = await alle<{ schicht_id: number }>(db, 'SELECT schicht_id FROM anmeldung WHERE id = ?', [anmeldungId]);
  if (!z.length) return [];
  const w = await warnungenFuerSchicht(db, z[0].schicht_id);
  return w.anmeldungen.get(anmeldungId) ?? [];
}
