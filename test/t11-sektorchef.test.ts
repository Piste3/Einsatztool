// T11: Sektorchef bestätigt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person } from './hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { speichereFremdabteilung } from '../src/domain/schicht.js';
import { zahlenFuerSchichten } from '../src/domain/zaehlung.js';

test('T11 Sektorchef zählt nicht als Teilnehmer, aber beim Essen', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1);
    await person(t.db, 2);
    const s = await einsatz(t.db, 'slowUp', inTagen(3, 8), inTagen(3, 16));
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon', rolle: 'Sektorchef' }, null);
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'bestaetigt', kanal: 'telefon' }, null);
    await speichereFremdabteilung(t.db, s.schichtId, { name: 'Pfadi', anzahl: '3' });
    const z = (await zahlenFuerSchichten(t.db, [s.schichtId])).get(s.schichtId)!;
    assert.equal(z.teilnehmende, 4); // 1 Person + 3 Fremdabteilung
    assert.equal(z.essen, 5); // dazu der Sektorchef
  } finally {
    await t.ende();
  }
});
