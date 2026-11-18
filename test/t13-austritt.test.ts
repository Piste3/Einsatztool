// T13: Import mit fehlender Person mit künftiger Anmeldung, und einer ohne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, person, einsatz, inTagen, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { erstelleVorschau, wendeImportAn } from '../src/domain/import-clubdesk.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';

test('T13 Person mit künftiger Anmeldung bleibt (W_AUSTRITT), die andere wird nach Bestätigung geleert', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Bleibt' });
    await person(t.db, 2, { vorname: 'Ben', nachname: 'Zukunft' });
    await person(t.db, 3, { vorname: 'Cara', nachname: 'Weg', email: 'cara@web.kkb.ch' });
    const s = await einsatz(t.db, 'Einsatz', inTagen(5, 8), inTagen(5, 12));
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'angemeldet', kanal: 'telefon' }, null);
    const csv = clubdeskCsv([{ id: 1, vorname: 'Anna', nachname: 'Bleibt' }]);
    const v = await erstelleVorschau(t.db, csv);
    assert.deepEqual(v.entferntMitZukunft.map((e) => e.clubdesk_id), [2]);
    assert.deepEqual(v.entferntMitZukunft[0].einsaetze, ['Einsatz']);
    assert.deepEqual(v.entferntOhneZukunft.map((e) => e.clubdesk_id), [3]);

    const r = await wendeImportAn(t.db, csv, { loeschen: [2, 3], loeschenBestaetigt: true, austritteBestaetigt: false, dateiname: null }, null);
    assert.ok(r.angewendet);
    const [p2] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 2');
    assert.equal(p2.nachname, 'Zukunft');
    assert.equal(p2.geloescht_am, null);
    const [p3] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 3');
    assert.equal(p3.clubdesk_id, 3);
    assert.equal(p3.nachname, null);
    assert.equal(p3.email, null);
    assert.ok(p3.geloescht_am);
  } finally {
    await t.ende();
  }
});
