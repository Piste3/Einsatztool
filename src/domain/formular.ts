// Öffentliches Anmeldeformular (15). Ohne Cookies, mit signiertem Token.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, liste, pflichtText, text } from './eingabe.js';
import { findePersonNachName, normalisiereName } from './personen.js';
import { fuegeEin, personenName, schreibeLog } from './anmeldung.js';
import { jetztIso } from './zeit.js';

/** Gültigkeit des Tokens: 2 Stunden (15.1.3). */
export const TOKEN_GUELTIG_MS = 2 * 60 * 60 * 1000;
/** Mindestzeit gegen Spam: 2 Sekunden (Abschnitt 3 des Auftrags). */
export const MINDESTZEIT_MS = 2000;

function signatur(secret: string, wert: string): string {
  return createHmac('sha256', secret).update(`formular:${wert}`).digest('base64url');
}

export function erstelleFormularToken(secret: string, jetzt = Date.now()): string {
  const ts = String(jetzt);
  return `${ts}.${signatur(secret, ts)}`;
}

export type TokenErgebnis = 'ok' | 'ungueltig' | 'abgelaufen' | 'zu_schnell';

export function pruefeFormularToken(secret: string, token: unknown, jetzt = Date.now()): TokenErgebnis {
  if (typeof token !== 'string') return 'ungueltig';
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return 'ungueltig';
  const erwartet = Buffer.from(signatur(secret, ts));
  const erhalten = Buffer.from(sig);
  if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) return 'ungueltig';
  const alter = jetzt - Number(ts);
  if (alter > TOKEN_GUELTIG_MS) return 'abgelaufen';
  if (alter < MINDESTZEIT_MS) return 'zu_schnell';
  return 'ok';
}

export interface FormularSchicht {
  id: number;
  name: string;
  start_zeit: string;
  end_zeit: string;
  ort: string | null;
  bemerkung_extern: string | null;
  min_alter: number | null;
  min_rang_name: string | null;
  einsatz_id: number;
  einsatz_name: string;
  einsatz_bemerkung_extern: string | null;
}

/** Regel 13.4: publizierte Schichten mit Ende in der Zukunft, gruppiert nach Einsatz. */
export async function sichtbareSchichten(db: Db): Promise<FormularSchicht[]> {
  return alle<FormularSchicht>(
    db,
    `SELECT s.id, s.name, s.start_zeit, s.end_zeit, s.ort, s.bemerkung_extern, s.min_alter, r.name AS min_rang_name,
            e.id AS einsatz_id, e.name AS einsatz_name, e.bemerkung_extern AS einsatz_bemerkung_extern
       FROM schicht s JOIN einsatz e ON e.id = s.einsatz_id LEFT JOIN rang r ON r.id = s.min_rang_id
      WHERE s.publiziert = 1 AND s.end_zeit > ?
      ORDER BY (SELECT MIN(x.start_zeit) FROM schicht x WHERE x.einsatz_id = e.id AND x.publiziert = 1), e.id, s.start_zeit, s.id`,
    [jetztIso()],
  );
}

export interface FormularEingabe {
  vorname: unknown;
  nachname: unknown;
  /** Freiwillig. Das Formular fragt seit 19.11.2026 nicht mehr danach (Wunsch Yann). */
  email?: unknown;
  /** Bemerkung für alle gewählten Schichten (älteres Formular). */
  bemerkung?: unknown;
  /** Bemerkung je Einsatz: Schlüssel = Einsatz-ID. Gilt für alle gewählten Schichten dieses Einsatzes. */
  bemerkungen?: Record<string, unknown>;
  schichten: unknown;
}

export interface FormularErgebnis {
  personId: number | null;
  anmeldungIds: number[];
}

const MAIL_MUSTER = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function haengeAn(alt: string | null, neu: string | null): string | null {
  if (!neu) return alt;
  return alt ? `${alt}\n${neu}` : neu;
}

/** Regel 15.3: Verarbeitung beim Absenden. Token, Honeypot und Ratenbegrenzung prüft die Route. */
export async function verarbeiteFormular(db: Db, e: FormularEingabe): Promise<FormularErgebnis> {
  const vorname = pflichtText(e.vorname, 'Vorname', 100);
  const nachname = pflichtText(e.nachname, 'Nachname', 100);
  // E-Mail ist freiwillig. Die Zuordnung läuft nur über den Namen (15.3.2 bis 15.3.5).
  const email = text(e.email, 'E-Mail', 255);
  if (email && !MAIL_MUSTER.test(email)) throw new Eingabefehler('Die E-Mail-Adresse ist ungültig.');
  // Essenseinschränkungen kommen nur aus den Stammdaten (Clubdesk). Das Formular fragt nicht mehr danach (Wunsch Yann).
  const bemerkungAlle = text(e.bemerkung, 'Bemerkung', 2000);
  const bemerkungJeEinsatz = new Map<number, string | null>();
  if (e.bemerkungen && typeof e.bemerkungen === 'object') {
    for (const [schluessel, wert] of Object.entries(e.bemerkungen)) {
      if (/^\d+$/.test(schluessel)) bemerkungJeEinsatz.set(Number(schluessel), text(wert, 'Bemerkung', 2000));
    }
  }
  const schichtIds = [...new Set(liste(e.schichten).filter((s) => /^\d+$/.test(s)).map(Number))];
  if (!schichtIds.length) throw new Eingabefehler('Wähle mindestens eine Schicht.');

  return transaktion(db, async (c) => {
    // Regel 15.3.1: Jede gewählte Schicht muss noch sichtbar sein (13.4).
    const sichtbar = await alle<{ id: number; einsatz_id: number }>(
      c,
      'SELECT id, einsatz_id FROM schicht WHERE id IN (?) AND publiziert = 1 AND end_zeit > ?',
      [schichtIds, jetztIso()],
    );
    if (sichtbar.length !== schichtIds.length) {
      throw new Eingabefehler('Eine gewählte Schicht ist nicht mehr verfügbar. Lade das Formular neu.');
    }

    // Regel 15.3.2 bis 15.3.5: Person suchen.
    const treffer = await findePersonNachName(c, vorname, nachname);
    const personId = treffer.length === 1 ? treffer[0] : null;
    let nameText = `${vorname} ${nachname}`;
    if (personId !== null) {
      const p = await eine<{ vorname: string | null; nachname: string | null }>(c, 'SELECT vorname, nachname FROM person WHERE clubdesk_id = ?', [personId]);
      if (p) nameText = personenName(p);
    }

    // Bemerkung: Text der Person zum Einsatz, Hinweis bei mehreren Treffern.
    const einsatzVon = new Map(sichtbar.map((x) => [x.id, x.einsatz_id]));
    const bemerkungFuer = (schichtId: number): string | null => {
      let b = haengeAn(bemerkungAlle, bemerkungJeEinsatz.get(einsatzVon.get(schichtId)!) ?? null);
      if (treffer.length > 1) b = haengeAn(b, `Mehrdeutig: Clubdesk-IDs ${treffer.join(', ')}`);
      return b;
    };

    const zeit = jetztIso();
    const ids: number[] = [];
    for (const schichtId of schichtIds) {
      const bemerkung = bemerkungFuer(schichtId);
      // Bestehenden Eintrag suchen: bekannte Person über person_id, unbekannte über Name und E-Mail (leer = leer).
      let vorhanden: { id: number; bemerkung: string | null } | undefined;
      if (personId !== null) {
        vorhanden = await eine(c, 'SELECT id, bemerkung FROM anmeldung WHERE schicht_id = ? AND person_id = ? FOR UPDATE', [schichtId, personId]);
      } else {
        const kandidaten = await alle<{ id: number; bemerkung: string | null; name_text: string; email_text: string | null }>(
          c,
          'SELECT id, bemerkung, name_text, email_text FROM anmeldung WHERE schicht_id = ? AND person_id IS NULL FOR UPDATE',
          [schichtId],
        );
        vorhanden = kandidaten.find(
          (k) => normalisiereName(k.name_text) === normalisiereName(nameText) && (k.email_text ?? '').toLowerCase() === (email ?? '').toLowerCase(),
        );
      }
      if (vorhanden) {
        // Regel 13.5.5: Das Formular überschreibt den Status nicht. Es hängt die Bemerkung an.
        const neu = haengeAn(vorhanden.bemerkung, bemerkung ?? 'Erneute Anmeldung über das Formular.');
        await schreibe(c, 'UPDATE anmeldung SET bemerkung = ?, geaendert_am = ?, version = version + 1 WHERE id = ?', [neu, zeit, vorhanden.id]);
        await schreibeLog(c, vorhanden.id, null, 'bemerkung', vorhanden.bemerkung, neu, zeit);
        ids.push(vorhanden.id);
        continue;
      }
      // Regel 15.3.6: Status angemeldet, Kanal formular. E-Mail nur bei unbekannten Personen (Entscheid Yann).
      const r = await fuegeEin(
        c,
        `INSERT INTO anmeldung (schicht_id, person_id, name_text, email_text, status, kanal, bemerkung, erstellt_am, geaendert_am)
         VALUES (?, ?, ?, ?, 'angemeldet', 'formular', ?, ?, ?)`,
        [schichtId, personId, nameText, personId === null ? email : null, bemerkung, zeit, zeit],
      );
      // Regel 15.3.7: Log-Eintrag mit benutzer_id leer.
      await schreibeLog(c, r.insertId, null, 'erstellt', null, 'angemeldet', zeit);
      ids.push(r.insertId);
    }
    return { personId, anmeldungIds: ids };
  });
}

/** Ratenbegrenzung: 20 Anfragen pro Stunde je IP-Adresse (15.2). Im Speicher. */
export class Ratenbegrenzung {
  private zaehler = new Map<string, number[]>();
  constructor(private grenze = 20, private fensterMs = 60 * 60 * 1000) {}

  erlaubt(ip: string, jetzt = Date.now()): boolean {
    const liste = (this.zaehler.get(ip) ?? []).filter((t) => jetzt - t < this.fensterMs);
    if (liste.length >= this.grenze) {
      this.zaehler.set(ip, liste);
      return false;
    }
    liste.push(jetzt);
    this.zaehler.set(ip, liste);
    if (this.zaehler.size > 10000) this.aufraeumen(jetzt);
    return true;
  }

  private aufraeumen(jetzt: number): void {
    for (const [ip, l] of this.zaehler) if (!l.some((t) => jetzt - t < this.fensterMs)) this.zaehler.delete(ip);
  }
}
