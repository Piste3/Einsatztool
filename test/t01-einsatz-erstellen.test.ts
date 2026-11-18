// T01: Einsatz mit Name, Start, Ende erstellen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, zeilen } from './hilfe.js';
import { isoUtc } from '../src/domain/zeit.js';

test('T01 Einsatz erstellen legt genau eine publizierte Schicht mit denselben Zeiten an', async () => {
  const t = await neueDatenbank();
  try {
    const start = inTagen(10, 7);
    const ende = inTagen(10, 15);
    const { einsatzId } = await einsatz(t.db, 'Herbstmesse 2026', start, ende, 'Messeplatz');
    const s = await zeilen(t.db, 'SELECT * FROM schicht WHERE einsatz_id = ?', [einsatzId]);
    assert.equal(s.length, 1);
    assert.equal(s[0].start_zeit, isoUtc(start));
    assert.equal(s[0].end_zeit, isoUtc(ende));
    assert.equal(Number(s[0].publiziert), 1);
    assert.equal(s[0].name, 'Herbstmesse 2026');
    assert.equal(s[0].ort, 'Messeplatz');
  } finally {
    await t.ende();
  }
});
