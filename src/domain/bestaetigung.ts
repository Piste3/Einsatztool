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
}

export interface LaufErgebnis {
  mails: number;
  eintraege: number;
  ohneAdresse: number;
}

/** Adresse für die Bestätigung: person.email, bei unzugeordneten Einträgen email_text (18.2.5). */
function empfaenger(a: OffeneBestaetigung): string | null {
  if (a.person_id !== null) return a.geloescht_am ? null : a.email;
  return a.email_text;
}

/**
 * Regel 18.2.2: Alle bestätigten Einträge mit leerem mail_gesendet_am und Ende in der Zukunft.
 * Eine Mail je Person mit allen Schichten. Danach mail_gesendet_am setzen.
 * Entscheid Yann: Unbekannte Personen mit gleicher Adresse erhalten eine gemeinsame Mail.
 * Ohne Adresse: kein Versand, ein Log-Eintrag je Änderung. Kommt später eine Adresse, geht die Mail im nächsten Lauf.
 */
export async function bestaetigungslauf(db: Db, replyTo: string): Promise<LaufErgebnis> {
  return transaktion(db, async (c) => {
    const jetzt = jetztIso();
    const offen = await alle<OffeneBestaetigung>(
      c,
      `SELECT a.id, a.person_id, a.name_text, a.email_text, a.rolle, p.vorname, p.email, p.geloescht_am,
              e.name AS einsatz, s.name AS schicht, s.start_zeit, s.end_zeit, s.ort
         FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id JOIN einsatz e ON e.id = s.einsatz_id
         LEFT JOIN person p ON p.clubdesk_id = a.person_id
        WHERE a.status = 'bestaetigt' AND a.mail_gesendet_am IS NULL AND s.end_zeit > ?
        ORDER BY s.start_zeit, a.id
        FOR UPDATE`,
      [jetzt],
    );
    const gruppen = new Map<string, { an: string; vorname: string; eintraege: OffeneBestaetigung[] }>();
    let ohneAdresse = 0;
    for (const a of offen) {
      const an = empfaenger(a);
      if (!an) {
        ohneAdresse++;
        await vermerkeOhneAdresse(c, a.id, jetzt);
        continue;
      }
      const schluessel = a.person_id !== null ? `p:${a.person_id}` : `m:${an.toLowerCase()}`;
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
      await schreibe(c, 'INSERT INTO mail_queue (an, reply_to, betreff, text, erstellt_am) VALUES (?, ?, ?, ?, ?)', [
        g.an, replyTo, BETREFF_BESTAETIGUNG, bestaetigungsText(g.vorname, schichten), jetzt,
      ]);
      const ids = g.eintraege.map((a) => a.id);
      await schreibe(c, 'UPDATE anmeldung SET mail_gesendet_am = ? WHERE id IN (?)', [jetzt, ids]);
      for (const id of ids) await schreibeLog(c, id, null, 'bestaetigungsmail', null, g.an, jetzt);
      eintraege += ids.length;
    }
    return { mails: gruppen.size, eintraege, ohneAdresse };
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
}

export const MAX_VERSUCHE = 5;
export const WARTEZEIT_MS = 5 * 60 * 1000;

/** Regel 18.1.2: Mails ohne gesendet_am, höchstens 5 Versuche, nach einem Fehler 5 Minuten warten. */
export async function faelligeMails(db: Db, limit = 20): Promise<MailZeile[]> {
  return alle<MailZeile>(
    db,
    `SELECT * FROM mail_queue WHERE gesendet_am IS NULL AND versuche < ? AND (naechster_versuch IS NULL OR naechster_versuch <= ?)
      ORDER BY id LIMIT ?`,
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
