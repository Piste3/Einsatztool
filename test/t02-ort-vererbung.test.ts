// T02: Ort des Einsatzes von A auf B ändern. Eine Schicht hat Ort C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, zeilen } from './hilfe.js';
import { aendereEinsatz } from '../src/domain/einsatz.js';
import { erstelleSchicht, aendereSchicht, ladeSchicht } from '../src/domain/schicht.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

test('T02 Ortsänderung im Einsatz gilt für Schichten mit A, die Schicht mit C bleibt', async () => {
  const t = await neueDatenbank();
  try {
    const start = inTagen(5, 7);
    const ende = inTagen(5, 12);
    const { einsatzId } = await einsatz(t.db, 'slowUp', start, ende, 'A');
    const zeit = { start_datum: lokalesDatum(start), start_zeit: lokaleZeit(start), end_datum: lokalesDatum(ende), end_zeit: lokaleZeit(ende) };
    const s2 = await erstelleSchicht(t.db, einsatzId, { name: 'Sektor Blau', ...zeit });
    const s3 = await erstelleSchicht(t.db, einsatzId, { name: 'Sektor Rot', ...zeit });
    assert.equal((await ladeSchicht(t.db, s2)).ort, 'A');
    await aendereSchicht(t.db, s3, { name: 'Sektor Rot', ...zeit, ort: 'C' });
    await aendereEinsatz(t.db, einsatzId, { name: 'slowUp', ort: 'B' });
    const orte = await zeilen(t.db, 'SELECT name, ort FROM schicht WHERE einsatz_id = ? ORDER BY id', [einsatzId]);
    assert.deepEqual(orte.map((o) => o.ort), ['B', 'B', 'C']);
  } finally {
    await t.ende();
  }
});
