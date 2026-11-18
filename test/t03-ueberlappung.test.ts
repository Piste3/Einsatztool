// T03: Person in zwei überlappenden Schichten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { warnungenFuerAnmeldung } from '../src/domain/warnungen.js';

test('T03 Überlappende Schichten ergeben W_UEBERLAPP, das Tool speichert trotzdem', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1);
    const a = await einsatz(t.db, 'Einsatz A', inTagen(3, 8), inTagen(3, 12));
    const b = await einsatz(t.db, 'Einsatz B', inTagen(3, 11), inTagen(3, 15));
    await setzeAnmeldung(t.db, { schichtId: a.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const id = await setzeAnmeldung(t.db, { schichtId: b.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    const w = await warnungenFuerAnmeldung(t.db, id);
    assert.ok(w.some((x) => x.code === 'W_UEBERLAPP'));
    assert.equal((await zeilen(t.db, 'SELECT * FROM anmeldung WHERE person_id = 1')).length, 2);
  } finally {
    await t.ende();
  }
});
