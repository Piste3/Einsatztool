// Tageslauf der Bestätigungsmails (18.2) und Mail-Warteschlange (18.1).
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { schreibeLog } from './anmeldung.js';
import { BETREFF_BESTAETIGUNG, bestaetigungsText, type BestaetigteSchicht } from './mail-vorlagen.js';
import { jetztIso } from './zeit.js';

interface OffeneBestaetigung {
  id: number;
  person_id: number | null;
  name_text: string;
  email_text: string | null;
  rolle: string | null;
  vorname: string | null;
  email: string | null;
  geloescht_am: string | null;
  einsatz: string;
  schicht: string;
  start_zeit: string;
  end_zeit: string;
  ort: string | null;
  schicht_id: number;
}

export interface LaufErgebnis {
  mails: number;
  eintraege: number;
  ohneAdresse: number;
  /** true: Die Bestätigungsmails sind ausgeschaltet. Der Lauf hat nichts getan. */
  aus?: boolean;
}

/** Adresse für die Bestätigung: person.email, bei unzugeordneten Einträgen email_text (18.2.5). */
function empfaenger(a: OffeneBestaetigung): string | null {
  if (a.person_id !== null) return a.geloescht_am ? null : a.email;
  return a.email_text;
}

/** Schlüssel einer Mail: je Person, bei unbekannten Personen je Adresse. */
function gruppenSchluessel(a: OffeneBestaetigung, an: string): string {
  return a.person_id !== null ? `p:${a.person_id}` : `m:${an.toLowerCase()}`;
}

const OFFEN_SQL = `SELECT a.id, a.person_id, a.name_text, a.email_text, a.rolle, p.vorname, p.email, p.geloescht_am,
              e.name AS einsatz, s.name AS schicht, s.start_zeit, s.end_zeit, s.ort, s.id AS schicht_id
         FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
         LEFT JOIN person p ON p.clubdesk_id = a.person_id
        WHERE a.status = 'bestaetigt' AND a.mail_gesendet_am IS NULL AND s.end_zeit > ?
        ORDER BY s.start_zeit, a.id`;

// ---------- Schalter «Bestätigungsmails» (Wunsch Yann 26.11.2026) ----------

const SCHALTER = 'bestaetigungsmails';

/** Vorgabe: eingeschaltet. Ohne Zeile in «einstellung» gilt ein. */
export async function bestaetigungsmailsAktiv(db: Db): Promise<boolean> {
  const z = await eine<{ wert: string }>(db, 'SELECT wert FROM einstellung WHERE schluessel = ?', [SCHALTER]);
  return !z || z.wert !== 'aus';
}

/**
 * Schaltet die Bestätigungsmails ein oder aus. Aus: Der Tageslauf und der Versand ruhen. Die Einträge warten.
 * Einschalten mit nachsenden = false: Wartende Einträge erhalten nie eine Mail (Statusprotokoll «mail_verworfen»).
 * Ungesendete Mails in der Warteschlange gelten dann als verworfen.
 */
export async function setzeBestaetigungsmails(db: Db, aktiv: boolean, benutzerId: number | null, nachsenden = true): Promise<{ verworfen: number }> {
  return transaktion(db, async (c) => {
    const jetzt = jetztIso();
    const vorher = await eine<{ wert: string }>(c, 'SELECT wert FROM einstellung WHERE schluessel = ? FOR UPDATE', [SCHALTER]);
    const alt = !vorher || vorher.wert !== 'aus';
    if (alt === aktiv) return { verworfen: 0 };
    await schreibe(
      c,
      `INSERT INTO einstellung (schluessel, wert, geaendert_am, geaendert_von) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE wert = VALUES(wert), geaendert_am = VALUES(geaendert_am), geaendert_von = VALUES(geaendert_von)`,
      [SCHALTER, aktiv ? 'ein' : 'aus', jetzt, benutzerId],
    );
    let verworfen = 0;
    if (aktiv && !nachsenden) {
      const offen = await alle<OffeneBestaetigung>(c, `${OFFEN_SQL} FOR UPDATE`, [jetzt]);
      const ids = offen.filter((a) => empfaenger(a)).map((a) => a.id);
      if (ids.length) {
        await schreibe(c, 'UPDATE anmeldung SET mail_gesendet_am = ? WHERE id IN (?)', [jetzt, ids]);
        for (const id of ids) await schreibeLog(c, id, benutzerId, 'mail_verworfen', null, 'Bestätigungsmails waren ausgeschaltet.', jetzt);
      }
      verworfen = ids.length;
      await schreibe(
        c,
        'UPDATE mail_queue SET fehler = ?, versuche = ? WHERE gesendet_am IS NULL AND versuche < ? AND manuell = 0',
        ['Verworfen: Bestätigungsmails waren ausgeschaltet.', MAX_VERSUCHE, MAX_VERSUCHE],
      );
    }
    await schreibe(c, 'INSERT INTO konfiguration_protokoll (zeit, benutzer_id, schluessel, alt, neu) VALUES (?, ?, ?, ?, ?)', [
      jetzt, benutzerId, 'Bestätigungsmails', alt ? 'ein' : 'aus',
      aktiv ? (nachsenden ? 'ein' : `ein (${verworfen} wartende verworfen)`) : 'aus',
    ]);
    return { verworfen };
  });
}

/**
 * Regel 18.2.2: Alle bestätigten Einträge mit leerem mail_gesendet_am und Ende in der Zukunft.
 * Eine Mail je Person mit allen Schichten. Danach mail_gesendet_am setzen.
 * Entscheid Yann: Unbekannte Personen mit gleicher Adresse erhalten eine gemeinsame Mail.
 * Ohne Adresse: kein Versand, ein Log-Eintrag je Änderung. Kommt später eine Adresse, geht die Mail im nächsten Lauf.
 * Ausgeschaltet: Der Lauf tut nichts.
 * `nur`: Mail nur für diese Person (Schlüssel aus `warteschlange()`), von Hand ausgelöst. Sie geht auch bei «aus» weg.
 */
export async function bestaetigungslauf(db: Db, replyTo: string, nur?: string): Promise<LaufErgebnis> {
  if (nur === undefined && !(await bestaetigungsmailsAktiv(db))) return { mails: 0, eintraege: 0, ohneAdresse: 0, aus: true };
  return transaktion(db, async (c) => {
    const jetzt = jetztIso();
    const offen = await alle<OffeneBestaetigung>(c, `${OFFEN_SQL} FOR UPDATE`, [jetzt]);
    const gruppen = new Map<string, { an: string; vorname: string; eintraege: OffeneBestaetigung[] }>();
    let ohneAdresse = 0;
    for (const a of offen) {
      const an = empfaenger(a);
      if (!an) {
        if (nur !== undefined) continue;
        ohneAdresse++;
        await vermerkeOhneAdresse(c, a.id, jetzt);
        continue;
      }
      const schluessel = gruppenSchluessel(a, an);
      if (nur !== undefined && schluessel !== nur) continue;
      if (!gruppen.has(schluessel)) {
        const vorname = a.vorname ?? a.name_text.split(/\s+/)[0] ?? '';
        gruppen.set(schluessel, { an, vorname, eintraege: [] });
      }
      gruppen.get(schluessel)!.eintraege.push(a);
    }
    let eintraege = 0;
    for (const g of gruppen.values()) {
      const schichten: BestaetigteSchicht[] = g.eintraege.map((a) => ({
        einsatz: a.einsatz, schicht: a.schicht, start: a.start_zeit, ende: a.end_zeit, ort: a.ort, rolle: a.rolle,
      }));
      await schreibe(c, 'INSERT INTO mail_queue (an, reply_to, betreff, text, erstellt_am, manuell) VALUES (?, ?, ?, ?, ?, ?)', [
        g.an, replyTo, BETREFF_BESTAETIGUNG, bestaetigungsText(g.vorname, schichten), jetzt, nur !== undefined ? 1 : 0,
      ]);
      const ids = g.eintraege.map((a) => a.id);
      await schreibe(c, 'UPDATE anmeldung SET mail_gesendet_am = ? WHERE id IN (?)', [jetzt, ids]);
      for (const id of ids) await schreibeLog(c, id, null, 'bestaetigungsmail', null, g.an, jetzt);
      eintraege += ids.length;
    }
    return { mails: gruppen.size, eintraege, ohneAdresse };
  });
}

export interface WartendeMail {
  /** Schlüssel für «Jetzt senden»: p:<Clubdesk-ID> oder m:<Adresse>. */
  schluessel: string;
  an: string;
  name: string;
  schichten: { einsatz: string; schicht: string; start_zeit: string; schicht_id: number }[];
}

/** Warteschlange für /admin/export: Mails, die der nächste Tageslauf anlegt (nur mit Adresse), je Person. */
export async function wartendeMails(db: Db): Promise<WartendeMail[]> {
  const offen = await alle<OffeneBestaetigung>(db, OFFEN_SQL, [jetztIso()]);
  const gruppen = new Map<string, WartendeMail>();
  for (const a of offen) {
    const an = empfaenger(a);
    if (!an) continue;
    const s = gruppenSchluessel(a, an);
    if (!gruppen.has(s)) gruppen.set(s, { schluessel: s, an, name: a.name_text, schichten: [] });
    gruppen.get(s)!.schichten.push({ einsatz: a.einsatz, schicht: a.schicht, start_zeit: a.start_zeit, schicht_id: a.schicht_id });
  }
  return [...gruppen.values()];
}

/** Mails in mail_queue, die noch nicht gesendet sind, auch mit Fehler, aufgegeben oder verworfen. */
export async function ungesendeteMails(db: Db, anzahl = 200): Promise<MailZeile[]> {
  return alle<MailZeile>(db, 'SELECT * FROM mail_queue WHERE gesendet_am IS NULL ORDER BY id DESC LIMIT ?', [anzahl]);
}

/** Die zuletzt gesendeten Mails. */
export async function gesendeteMails(db: Db, anzahl = 20): Promise<MailZeile[]> {
  return alle<MailZeile>(db, 'SELECT * FROM mail_queue WHERE gesendet_am IS NOT NULL ORDER BY gesendet_am DESC, id DESC LIMIT ?', [anzahl]);
}

/**
 * Eine Mail aus mail_queue von Hand sofort senden: Der Versand versucht sie im nächsten Durchgang (höchstens 10 Sekunden).
 * Gilt auch für Mails mit Fehler oder nach 5 Versuchen. Sie geht auch bei ausgeschalteten Bestätigungsmails weg.
 */
export async function sendeMailErneut(db: Db, id: number): Promise<boolean> {
  return transaktion(db, async (c) => {
    const m = await eine<{ id: number }>(c, 'SELECT id FROM mail_queue WHERE id = ? AND gesendet_am IS NULL FOR UPDATE', [id]);
    if (!m) return false;
    await schreibe(c, 'UPDATE mail_queue SET versuche = 0, naechster_versuch = NULL, fehler = NULL, manuell = 1 WHERE id = ?', [id]);
    return true;
  });
}

/** Ein Log-Eintrag je Änderung: nur, wenn seit dem letzten Wechsel nach «bestätigt» noch keiner besteht. */
async function vermerkeOhneAdresse(c: Db, anmeldungId: number, jetzt: string): Promise<void> {
  const z = await eine<{ letzte: string | null; vermerkt: string | null }>(
    c,
    `SELECT
       (SELECT MAX(zeit) FROM status_log WHERE anmeldung_id = ? AND ((aktion = 'status' AND neu_wert = 'bestaetigt') OR aktion = 'erstellt')) AS letzte,
       (SELECT MAX(zeit) FROM status_log WHERE anmeldung_id = ? AND aktion = 'mail_ohne_adresse') AS vermerkt`,
    [anmeldungId, anmeldungId],
  );
  if (z?.vermerkt && (!z.letzte || z.vermerkt >= z.letzte)) return;
  await schreibeLog(c, anmeldungId, null, 'mail_ohne_adresse', null, 'Keine Mail-Adresse. Bestätigung nicht gesendet.', jetzt);
}

/** Für /admin/export: bestätigte Einträge ohne Adresse (18.2.5). */
export async function bestaetigungenOhneAdresse(db: Db): Promise<{ id: number; name_text: string; einsatz: string; schicht: string; start_zeit: string; schicht_id: number }[]> {
  return alle(
    db,
    `SELECT a.id, a.name_text, e.name AS einsatz, s.name AS schicht, s.start_zeit, s.id AS schicht_id
       FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
       LEFT JOIN person p ON p.clubdesk_id = a.person_id
      WHERE a.status = 'bestaetigt' AND a.mail_gesendet_am IS NULL AND s.end_zeit > ?
        AND ((a.person_id IS NOT NULL AND (p.email IS NULL OR p.email = '' OR p.geloescht_am IS NOT NULL))
          OR (a.person_id IS NULL AND (a.email_text IS NULL OR a.email_text = '')))
      ORDER BY s.start_zeit`,
    [jetztIso()],
  );
}

export interface MailZeile {
  id: number;
  an: string;
  reply_to: string | null;
  betreff: string;
  text: string;
  erstellt_am: string;
  gesendet_am: string | null;
  fehler: string | null;
  versuche: number;
  manuell: number;
}

export const MAX_VERSUCHE = 5;
export const WARTEZEIT_MS = 5 * 60 * 1000;

/**
 * Regel 18.1.2: Mails ohne gesendet_am, höchstens 5 Versuche, nach einem Fehler 5 Minuten warten.
 * Bestätigungsmails aus: nur Mails, die jemand von Hand ausgelöst hat.
 */
export async function faelligeMails(db: Db, limit = 20): Promise<MailZeile[]> {
  const nurManuell = !(await bestaetigungsmailsAktiv(db));
  return alle<MailZeile>(
    db,
    `SELECT * FROM mail_queue WHERE gesendet_am IS NULL AND versuche < ? AND (naechster_versuch IS NULL OR naechster_versuch <= ?)
      ${nurManuell ? 'AND manuell = 1' : ''} ORDER BY id LIMIT ?`,
    [MAX_VERSUCHE, jetztIso(), limit],
  );
}

export async function markiereGesendet(db: Db, id: number): Promise<void> {
  await schreibe(db, 'UPDATE mail_queue SET gesendet_am = ?, fehler = NULL WHERE id = ?', [jetztIso(), id]);
}

/** Regel 18.1.3: Fehler speichern, versuche erhöhen, nach 5 Minuten erneut. */
export async function markiereFehler(db: Db, id: number, fehler: string): Promise<void> {
  const naechster = new Date(Date.now() + WARTEZEIT_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  await schreibe(db, 'UPDATE mail_queue SET fehler = ?, versuche = versuche + 1, naechster_versuch = ? WHERE id = ?', [
    fehler.slice(0, 2000), naechster, id,
  ]);
}

/** Regel 18.1.6: Mails mit Fehler für /admin/export. */
export async function mailsMitFehler(db: Db): Promise<MailZeile[]> {
  return alle<MailZeile>(db, 'SELECT * FROM mail_queue WHERE gesendet_am IS NULL AND fehler IS NOT NULL ORDER BY id DESC LIMIT 100');
}
