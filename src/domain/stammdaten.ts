// Stammdaten: Ränge (14.5), Rollen (Entscheid Yann), Benutzer (22.1).
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, NichtGefunden, pflichtText } from './eingabe.js';

// ---------- Ränge ----------

export interface Rang {
  id: number;
  name: string;
  reihenfolge: number;
  /** 1 = Personen mit diesem Rang erhalten ein Aufgebot (Brief). Vorgabe 1. */
  aufgebot: number;
  personen: number;
  schichten: number;
}

/** Ränge, höchster zuerst. Kleine Zahl in reihenfolge = tiefer Rang. */
export async function raenge(db: Db): Promise<Rang[]> {
  return alle<Rang>(
    db,
    `SELECT r.id, r.name, r.reihenfolge, r.aufgebot,
            (SELECT COUNT(*) FROM person p WHERE p.rang_id = r.id) AS personen,
            (SELECT COUNT(*) FROM schicht s WHERE s.min_rang_id = r.id) AS schichten
       FROM rang r ORDER BY r.reihenfolge DESC`,
  );
}

/** Entscheid Yann: Ein neuer Rang kommt ans Ende (tiefster Rang). */
export async function legeRangAn(db: Db, nameRoh: unknown): Promise<void> {
  const name = pflichtText(nameRoh, 'Name', 100);
  await transaktion(db, async (c) => {
    if (await eine(c, 'SELECT id FROM rang WHERE name = ?', [name])) throw new Eingabefehler('Diesen Rang gibt es schon.');
    // Alle bestehenden Ränge rücken um eins nach oben. Absteigend, damit UNIQUE nicht stört.
    await schreibe(c, 'UPDATE rang SET reihenfolge = reihenfolge + 1 ORDER BY reihenfolge DESC');
    await schreibe(c, 'INSERT INTO rang (name, reihenfolge) VALUES (?, 1)', [name]);
  });
}

/** Regel 14.5.2: «Höher» oder «Tiefer» tauscht mit dem Nachbarn. */
export async function verschiebeRang(db: Db, id: number, richtung: 'hoeher' | 'tiefer'): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await eine<{ id: number; reihenfolge: number }>(c, 'SELECT id, reihenfolge FROM rang WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw new NichtGefunden('Rang nicht gefunden.');
    const nachbar = await eine<{ id: number; reihenfolge: number }>(
      c,
      richtung === 'hoeher'
        ? 'SELECT id, reihenfolge FROM rang WHERE reihenfolge > ? ORDER BY reihenfolge ASC LIMIT 1 FOR UPDATE'
        : 'SELECT id, reihenfolge FROM rang WHERE reihenfolge < ? ORDER BY reihenfolge DESC LIMIT 1 FOR UPDATE',
      [r.reihenfolge],
    );
    if (!nachbar) return;
    const temp = await eine<{ t: number }>(c, 'SELECT COALESCE(MIN(reihenfolge), 0) - 1 AS t FROM rang');
    await schreibe(c, 'UPDATE rang SET reihenfolge = ? WHERE id = ?', [Number(temp!.t), r.id]);
    await schreibe(c, 'UPDATE rang SET reihenfolge = ? WHERE id = ?', [r.reihenfolge, nachbar.id]);
    await schreibe(c, 'UPDATE rang SET reihenfolge = ? WHERE id = ?', [nachbar.reihenfolge, r.id]);
  });
}

/** Regel 14.5.3: Umbenennen. Die Zuordnung zu Personen und Schichten bleibt. */
/** Wunsch Yann 26.11.2026: Schalter «Aufgebot» je Rang. Aus = keine Briefe für Personen mit diesem Rang. */
export async function setzeRangAufgebot(db: Db, id: number, aufgebot: boolean): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'UPDATE rang SET aufgebot = ? WHERE id = ?', [aufgebot ? 1 : 0, id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Rang nicht gefunden.');
  });
}

export async function benenneRangUm(db: Db, id: number, nameRoh: unknown): Promise<void> {
  const name = pflichtText(nameRoh, 'Name', 100);
  await transaktion(db, async (c) => {
    const doppelt = await eine(c, 'SELECT id FROM rang WHERE name = ? AND id <> ?', [name, id]);
    if (doppelt) throw new Eingabefehler('Diesen Rang gibt es schon.');
    const r = await schreibe(c, 'UPDATE rang SET name = ? WHERE id = ?', [name, id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Rang nicht gefunden.');
  });
}

/** Regel 14.5.4: Löschen nur ohne Nutzer. Sonst nennt das Tool die Zahl der Nutzer. */
export async function loescheRang(db: Db, id: number): Promise<void> {
  await transaktion(db, async (c) => {
    const n = await eine<{ p: number; s: number }>(
      c,
      `SELECT (SELECT COUNT(*) FROM person WHERE rang_id = ?) AS p, (SELECT COUNT(*) FROM schicht WHERE min_rang_id = ?) AS s`,
      [id, id],
    );
    const p = Number(n?.p ?? 0);
    const s = Number(n?.s ?? 0);
    if (p + s > 0) throw new Eingabefehler(`Der Rang ist in Gebrauch: ${p} Personen, ${s} Schichten.`);
    await schreibe(c, 'DELETE FROM rang WHERE id = ?', [id]);
  });
}

// ---------- Rollen ----------

export interface Rolle {
  name: string;
  reihenfolge: number;
  zaehlt_teilnehmer: number;
  nutzung: number;
}

export async function rollen(db: Db): Promise<Rolle[]> {
  return alle<Rolle>(
    db,
    `SELECT r.name, r.reihenfolge, r.zaehlt_teilnehmer,
            (SELECT COUNT(*) FROM schicht_rolle sr WHERE sr.rolle = r.name) + (SELECT COUNT(*) FROM anmeldung a WHERE a.rolle = r.name) AS nutzung
       FROM rolle r ORDER BY r.reihenfolge, r.name`,
  );
}

export async function legeRolleAn(db: Db, nameRoh: unknown, zaehlt: boolean): Promise<void> {
  const name = pflichtText(nameRoh, 'Name', 100);
  await transaktion(db, async (c) => {
    if (await eine(c, 'SELECT name FROM rolle WHERE name = ?', [name])) throw new Eingabefehler('Diese Rolle gibt es schon.');
    await schreibe(
      c,
      'INSERT INTO rolle (name, reihenfolge, zaehlt_teilnehmer) SELECT ?, COALESCE(MAX(reihenfolge), 0) + 1, ? FROM rolle',
      [name, zaehlt ? 1 : 0],
    );
  });
}

export async function verschiebeRolle(db: Db, name: string, richtung: 'hoch' | 'runter'): Promise<void> {
  await transaktion(db, async (c) => {
    const liste = await alle<{ name: string; reihenfolge: number }>(c, 'SELECT name, reihenfolge FROM rolle ORDER BY reihenfolge, name FOR UPDATE');
    const i = liste.findIndex((r) => r.name === name);
    if (i < 0) throw new NichtGefunden('Rolle nicht gefunden.');
    const j = richtung === 'hoch' ? i - 1 : i + 1;
    if (j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    for (let k = 0; k < liste.length; k++) {
      await schreibe(c, 'UPDATE rolle SET reihenfolge = ? WHERE name = ?', [k + 1, liste[k].name]);
    }
  });
}

export async function setzeRolleZaehlt(db: Db, name: string, zaehlt: boolean): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'UPDATE rolle SET zaehlt_teilnehmer = ? WHERE name = ?', [zaehlt ? 1 : 0, name]);
    if (r.affectedRows === 0) throw new NichtGefunden('Rolle nicht gefunden.');
  });
}

/** Entscheid Yann: Nur unbenutzte Rollen lassen sich löschen. Umbenennen geht nicht. */
export async function loescheRolle(db: Db, name: string): Promise<void> {
  await transaktion(db, async (c) => {
    const n = await eine<{ n: number }>(
      c,
      'SELECT (SELECT COUNT(*) FROM schicht_rolle WHERE rolle = ?) + (SELECT COUNT(*) FROM anmeldung WHERE rolle = ?) AS n',
      [name, name],
    );
    if (Number(n?.n ?? 0) > 0) throw new Eingabefehler(`Die Rolle ist in Gebrauch (${Number(n!.n)} Mal).`);
    await schreibe(c, 'DELETE FROM rolle WHERE name = ?', [name]);
  });
}

// ---------- Benutzer ----------

export interface Benutzer {
  id: number;
  name: string;
  email: string;
  entra_oid: string;
  rolle: 'admin' | 'aufgebot';
  aktiv: number;
}

export async function benutzerListe(db: Db): Promise<Benutzer[]> {
  return alle<Benutzer>(db, 'SELECT * FROM benutzer ORDER BY name');
}

/**
 * Regel 22.1.6: Beim ersten Login legt das Tool den Benutzer an. Bei jedem Login aktualisiert
 * es Name, E-Mail und Rolle. Ein inaktiver Benutzer kommt nicht hinein.
 */
export async function benutzerNachLogin(
  db: Db,
  d: { oid: string; name: string; email: string; rolle: 'admin' | 'aufgebot' },
): Promise<Benutzer> {
  return transaktion(db, async (c) => {
    const vorhanden = await eine<Benutzer>(c, 'SELECT * FROM benutzer WHERE entra_oid = ? FOR UPDATE', [d.oid]);
    if (vorhanden) {
      await schreibe(c, 'UPDATE benutzer SET name = ?, email = ?, rolle = ? WHERE id = ?', [d.name, d.email, d.rolle, vorhanden.id]);
      return { ...vorhanden, name: d.name, email: d.email, rolle: d.rolle };
    }
    // Eine E-Mail-Adresse kann nach einem Kontowechsel schon vorhanden sein. Dann übernimmt das Tool die Zeile.
    const gleicheMail = await eine<Benutzer>(c, 'SELECT * FROM benutzer WHERE email = ? FOR UPDATE', [d.email]);
    if (gleicheMail) {
      await schreibe(c, 'UPDATE benutzer SET name = ?, entra_oid = ?, rolle = ? WHERE id = ?', [d.name, d.oid, d.rolle, gleicheMail.id]);
      return { ...gleicheMail, name: d.name, entra_oid: d.oid, rolle: d.rolle };
    }
    const r = await schreibe(c, 'INSERT INTO benutzer (name, email, entra_oid, rolle, aktiv) VALUES (?, ?, ?, ?, 1)', [
      d.name, d.email, d.oid, d.rolle,
    ]);
    return { id: r.insertId, name: d.name, email: d.email, entra_oid: d.oid, rolle: d.rolle, aktiv: 1 };
  });
}

export async function setzeBenutzerAktiv(db: Db, id: number, aktiv: boolean): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'UPDATE benutzer SET aktiv = ? WHERE id = ?', [aktiv ? 1 : 0, id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Benutzer nicht gefunden.');
    if (!aktiv) await schreibe(c, 'DELETE FROM sitzung WHERE benutzer_id = ?', [id]);
  });
}

/** Prüft, ob die Liste aus dem Browser genau die aktuellen Einträge enthält. Sonst hat jemand inzwischen etwas geändert. */
function gleicheMenge<T>(neu: T[], alt: T[]): boolean {
  return neu.length === alt.length && new Set(neu).size === neu.length && alt.every((x) => neu.includes(x));
}

/**
 * Ziehen mit der Maus (Wunsch Yann 20.11.2026): setzt die ganze Reihenfolge der Ränge.
 * ids: von oben (höchster Rang) nach unten (tiefster Rang). Kleine Zahl in `reihenfolge` = tiefer Rang.
 */
export async function ordneRaenge(db: Db, ids: number[]): Promise<void> {
  await transaktion(db, async (c) => {
    const alt = await alle<{ id: number }>(c, 'SELECT id FROM rang ORDER BY reihenfolge DESC FOR UPDATE');
    if (!gleicheMenge(ids, alt.map((r) => Number(r.id)))) {
      throw new Eingabefehler('Die Ränge haben sich inzwischen geändert. Die Seite zeigt den neuen Stand. Zieh den Rang noch einmal.');
    }
    // Spalte ist eindeutig: zuerst auf freie negative Werte, dann auf die neuen Werte.
    for (let i = 0; i < ids.length; i++) await schreibe(c, 'UPDATE rang SET reihenfolge = ? WHERE id = ?', [-(i + 1), ids[i]]);
    for (let i = 0; i < ids.length; i++) await schreibe(c, 'UPDATE rang SET reihenfolge = ? WHERE id = ?', [ids.length - i, ids[i]]);
  });
}

/** Ziehen mit der Maus: setzt die ganze Reihenfolge der Rollen, von oben nach unten. */
export async function ordneRollen(db: Db, namen: string[]): Promise<void> {
  await transaktion(db, async (c) => {
    const alt = await alle<{ name: string }>(c, 'SELECT name FROM rolle ORDER BY reihenfolge, name FOR UPDATE');
    if (!gleicheMenge(namen, alt.map((r) => r.name))) {
      throw new Eingabefehler('Die Rollen haben sich inzwischen geändert. Die Seite zeigt den neuen Stand. Zieh die Rolle noch einmal.');
    }
    for (let i = 0; i < namen.length; i++) await schreibe(c, 'UPDATE rolle SET reihenfolge = ? WHERE name = ?', [i + 1, namen[i]]);
  });
}

/** Kürzel bekannter Rollen (Wunsch Yann 23.11.2026). Andere Rollen zeigen den vollen Namen. */
export const ROLLE_KURZ: Record<string, string> = { Einsatzleitung: 'EL', Busfahrer: 'BF', Sektorchef: 'SC' };
export function rolleKurz(name: string): string | null {
  return ROLLE_KURZ[name] ?? null;
}
