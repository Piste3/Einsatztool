// T04: Person in zwei aufeinanderfolgenden Schichten (Ende = Start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person } from './hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { warnungenFuerAnmeldung } from '../src/domain/warnungen.js';

test('T04 Aufeinanderfolgende Schichten ergeben keine Warnung', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1);
    const a = await einsatz(t.db, 'Tag', inTagen(3, 8), inTagen(3, 12));
    const b = await einsatz(t.db, 'Nacht', inTagen(3, 12), inTagen(3, 18));
    const ia = await setzeAnmeldung(t.db, { schichtId: a.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    const ib = await setzeAnmeldung(t.db, { schichtId: b.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    assert.deepEqual(await warnungenFuerAnmeldung(t.db, ia), []);
    assert.deepEqual(await warnungenFuerAnmeldung(t.db, ib), []);
  } finally {
    await t.ende();
  }
});
