// Tenue-Vorlagen (Wunsch Yann 20.11.2026).
// Der Admin legt in Admin › Einstellungen › Stammdaten Vorlagen an. In Schicht und Einsatz wählt man eine Vorlage.
// Das Tool kopiert dann den Text ins Feld «Tenue». Der Text bleibt danach frei bearbeitbar.
// Eine Vorlage ist nur eine Kopiervorlage: Ändern oder Löschen ändert keine Schicht.
import { alle, eine, schreibe, transaktion, type Db } from '../db/db.js';
import { Eingabefehler, NichtGefunden, pflichtText } from './eingabe.js';

export interface TenueVorlage {
  id: number;
  name: string;
  text: string;
  reihenfolge: number;
  /** 1 = Standard. Ein neuer Einsatz übernimmt diesen Text. Höchstens eine Vorlage ist Standard. */
  standard: number;
}

/** Gleiche Länge wie das Feld «Tenue» in Einsatz und Schicht. */
const MAX_TEXT = 255;

export async function tenueVorlagen(db: Db): Promise<TenueVorlage[]> {
  return alle<TenueVorlage>(db, 'SELECT id, name, text, reihenfolge, standard FROM tenue_vorlage ORDER BY reihenfolge, id');
}

function werte(nameRoh: unknown, textRoh: unknown): { name: string; text: string } {
  return { name: pflichtText(nameRoh, 'Name', 100), text: pflichtText(textRoh, 'Text', MAX_TEXT) };
}

export async function legeTenueVorlageAn(db: Db, nameRoh: unknown, textRoh: unknown): Promise<void> {
  const { name, text } = werte(nameRoh, textRoh);
  await transaktion(db, async (c) => {
    if (await eine(c, 'SELECT id FROM tenue_vorlage WHERE name = ?', [name])) throw new Eingabefehler('Diese Vorlage gibt es schon.');
    // Eine neue Vorlage kommt ans Ende.
    await schreibe(c, 'INSERT INTO tenue_vorlage (name, text, reihenfolge) SELECT ?, ?, COALESCE(MAX(reihenfolge), 0) + 1 FROM tenue_vorlage', [name, text]);
  });
}

export async function aendereTenueVorlage(db: Db, id: number, nameRoh: unknown, textRoh: unknown): Promise<void> {
  const { name, text } = werte(nameRoh, textRoh);
  await transaktion(db, async (c) => {
    if (await eine(c, 'SELECT id FROM tenue_vorlage WHERE name = ? AND id <> ?', [name, id])) throw new Eingabefehler('Diese Vorlage gibt es schon.');
    const r = await schreibe(c, 'UPDATE tenue_vorlage SET name = ?, text = ? WHERE id = ?', [name, text, id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Vorlage nicht gefunden.');
  });
}

/** Löscht nur die Vorlage. Schichten und Einsätze behalten ihren Text. Die Rückfrage stellt der Browser. */
export async function loescheTenueVorlage(db: Db, id: number): Promise<void> {
  await transaktion(db, async (c) => {
    const r = await schreibe(c, 'DELETE FROM tenue_vorlage WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw new NichtGefunden('Vorlage nicht gefunden.');
  });
}

/**
 * Standard-Vorlage (Wunsch Yann 24.11.2026). `an = true` macht die Vorlage zum Standard und nimmt den Standard allen anderen.
 * `an = false` nimmt ihr den Standard. Danach gibt es keinen Standard.
 */
export async function setzeStandardTenue(db: Db, id: number, an: boolean): Promise<void> {
  await transaktion(db, async (c) => {
    if (!(await eine(c, 'SELECT id FROM tenue_vorlage WHERE id = ? FOR UPDATE', [id]))) throw new NichtGefunden('Vorlage nicht gefunden.');
    if (an) await schreibe(c, 'UPDATE tenue_vorlage SET standard = IF(id = ?, 1, 0)', [id]);
    else await schreibe(c, 'UPDATE tenue_vorlage SET standard = 0 WHERE id = ?', [id]);
  });
}

/** Text der Standard-Vorlage oder null. Ein neuer Einsatz und seine Standardschicht übernehmen ihn. */
export async function standardTenue(db: Db): Promise<TenueVorlage | null> {
  return (await eine<TenueVorlage>(db, 'SELECT id, name, text, reihenfolge, standard FROM tenue_vorlage WHERE standard = 1 ORDER BY reihenfolge, id LIMIT 1')) ?? null;
}

/** Menü ⋮: einen Platz nach oben oder unten. */
export async function verschiebeTenueVorlage(db: Db, id: number, richtung: 'hoch' | 'runter'): Promise<void> {
  await transaktion(db, async (c) => {
    const liste = await alle<{ id: number }>(c, 'SELECT id FROM tenue_vorlage ORDER BY reihenfolge, id FOR UPDATE');
    const ids = liste.map((x) => Number(x.id));
    const i = ids.indexOf(id);
    if (i < 0) throw new NichtGefunden('Vorlage nicht gefunden.');
    const j = richtung === 'hoch' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (let k = 0; k < ids.length; k++) await schreibe(c, 'UPDATE tenue_vorlage SET reihenfolge = ? WHERE id = ?', [k + 1, ids[k]]);
  });
}

/** Ziehen mit der Maus: setzt die ganze Reihenfolge. Passt die Liste nicht zum Stand in der Datenbank, ändert das Tool nichts. */
export async function ordneTenueVorlagen(db: Db, ids: number[]): Promise<void> {
  await transaktion(db, async (c) => {
    const alt = (await alle<{ id: number }>(c, 'SELECT id FROM tenue_vorlage ORDER BY reihenfolge, id FOR UPDATE')).map((x) => Number(x.id));
    if (ids.length !== alt.length || new Set(ids).size !== ids.length || !alt.every((x) => ids.includes(x))) {
      throw new Eingabefehler('Die Vorlagen haben sich inzwischen geändert. Die Seite zeigt den neuen Stand. Zieh die Vorlage noch einmal.');
    }
    for (let i = 0; i < ids.length; i++) await schreibe(c, 'UPDATE tenue_vorlage SET reihenfolge = ? WHERE id = ?', [i + 1, ids[i]]);
  });
}

/**
 * Feld «tenue_vorlage» aus dem Formular von Schicht oder Einsatz.
 * Mit Skript kopiert der Browser den Text schon ins Feld «Tenue» und leert die Auswahl.
 * Ohne Skript ist die Auswahl gesetzt: Dann ersetzt der Text der Vorlage das Feld «Tenue».
 */
export async function tenueMitVorlage(db: Db, vorlageRoh: unknown, tenue: unknown): Promise<unknown> {
  if (vorlageRoh === undefined || vorlageRoh === null || vorlageRoh === '') return tenue;
  const id = Number(vorlageRoh);
  if (!Number.isInteger(id) || id < 1) throw new Eingabefehler('Tenue-Vorlage ist ungültig.');
  const v = await eine<{ text: string }>(db, 'SELECT text FROM tenue_vorlage WHERE id = ?', [id]);
  if (!v) throw new Eingabefehler('Die Tenue-Vorlage gibt es nicht mehr. Wähl eine andere oder schreib das Tenue selbst.');
  return v.text;
}
