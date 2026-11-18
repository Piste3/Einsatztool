// T21: Unzugeordneten Eintrag einer Person zuordnen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { ordneZu, setzeAnmeldung } from '../src/domain/anmeldung.js';
import { schreibe } from '../src/db/db.js';

async function unbekannt(db: any, schichtId: number, name: string): Promise<number> {
  const r = await schreibe(
    db,
    `INSERT INTO anmeldung (schicht_id, person_id, name_text, email_text, status, kanal, erstellt_am, geaendert_am)
     VALUES (?, NULL, ?, 'x@example.ch', 'angemeldet', 'formular', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [schichtId, name],
  );
  return r.insertId;
}

test('T21 Zuordnen setzt person_id und Namen, schreibt Protokoll, führt nichts zusammen', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Einsatz', inTagen(10, 8), inTagen(10, 12));
    await person(t.db, 7, { vorname: 'Mia', nachname: 'Muster' });
    await person(t.db, 8, { vorname: 'Leo', nachname: 'Doppelt' });
    const id = await unbekannt(t.db, s.schichtId, 'mia muster');
    assert.deepEqual(await ordneZu(t.db, id, 7, null), { ok: true });
    const [a] = await zeilen(t.db, 'SELECT * FROM anmeldung WHERE id = ?', [id]);
    assert.equal(a.person_id, 7);
    assert.equal(a.name_text, 'Mia Muster');
    const log = await zeilen(t.db, "SELECT * FROM status_log WHERE anmeldung_id = ? AND aktion = 'zugeordnet'", [id]);
    assert.equal(log.length, 1);

    // Person hat schon einen Eintrag: nichts zusammenführen.
    const bestehend = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 8, status: 'bestaetigt', kanal: 'telefon' }, null);
    const id2 = await unbekannt(t.db, s.schichtId, 'Leo D.');
    assert.deepEqual(await ordneZu(t.db, id2, 8, null), { ok: false, bestehendeId: bestehend });
    const [b] = await zeilen(t.db, 'SELECT * FROM anmeldung WHERE id = ?', [id2]);
    assert.equal(b.person_id, null);
    const anzahl = await zeilen(t.db, 'SELECT COUNT(*) AS n FROM anmeldung WHERE schicht_id = ?', [s.schichtId]);
    assert.equal(Number(anzahl[0].n), 3);
  } finally {
    await t.ende();
  }
});
