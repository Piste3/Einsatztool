// T06: Formular mit unbekanntem Namen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { warnungenFuerAnmeldung } from '../src/domain/warnungen.js';

test('T06 Unbekannter Name: person_id leer, W_UNBEKANNT, angemeldet, Kanal formular', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Müller' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(4, 8), inTagen(4, 12));
    const r = await verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', email: 'lea@example.ch', schichten: [String(s.schichtId)] });
    assert.equal(r.personId, null);
    const [a] = await zeilen(t.db, 'SELECT * FROM anmeldung WHERE id = ?', [r.anmeldungIds[0]]);
    assert.equal(a.person_id, null);
    assert.equal(a.status, 'angemeldet');
    assert.equal(a.kanal, 'formular');
    assert.equal(a.email_text, 'lea@example.ch');
    assert.ok((await warnungenFuerAnmeldung(t.db, a.id)).some((w) => w.code === 'W_UNBEKANNT'));
    // Umlaut-Vergleich: «Mueller» trifft «Müller».
    const r2 = await verarbeiteFormular(t.db, { vorname: ' anna ', nachname: 'Mueller', email: 'x@example.ch', schichten: [String(s.schichtId)] });
    assert.equal(r2.personId, 1);
    const [b] = await zeilen(t.db, 'SELECT email_text FROM anmeldung WHERE id = ?', [r2.anmeldungIds[0]]);
    assert.equal(b.email_text, null);
  } finally {
    await t.ende();
  }
});
