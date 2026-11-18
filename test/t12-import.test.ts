// T12: Import mit neuen, geänderten und fehlenden Personen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, person, rang, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { erstelleVorschau, wendeImportAn } from '../src/domain/import-clubdesk.js';

test('T12 Vorschau zeigt die richtigen Zahlen, eine zweite Anwendung ändert nichts', async () => {
  const t = await neueDatenbank();
  try {
    await rang(t.db, 'Kadett', 1);
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Alt', email: 'anna@web.kkb.ch' });
    await person(t.db, 2, { vorname: 'Ben', nachname: 'Bleibt' });
    await person(t.db, 3, { vorname: 'Cara', nachname: 'Geht' });
    const csv = clubdeskCsv([
      { id: 1, vorname: 'Anna', nachname: 'Neu', email: 'anna@web.kkb.ch', rang: 'Kadett', geburtsdatum: '01.02.2008' },
      { id: 2, vorname: 'Ben', nachname: 'Bleibt' },
      { id: 4, vorname: 'Dario', nachname: 'Müller', email: 'dario@gmail.com', rang: 'Unbekannt' },
    ]);
    // Person 2 hat in der Datenbank dieselben Werte wie die CSV (Adresse Weg 1, 4000 Basel).
    await t.db.query("UPDATE person SET strasse = 'Weg 1', plz = '4000', ort = 'Basel' WHERE clubdesk_id = 2");
    const v = await erstelleVorschau(t.db, csv);
    assert.deepEqual(v.fehler, []);
    assert.equal(v.neu.length, 1);
    assert.equal(v.geaendert.length, 1);
    assert.equal(v.unveraendert, 1);
    assert.equal(v.entferntOhneZukunft.length, 1);
    assert.deepEqual(v.unbekannteRaenge, ['Unbekannt']);
    assert.equal(v.ohneVereinsadresse, 2);
    assert.equal(v.neu[0].nachname, 'Müller');
    assert.equal(v.neu[0].email, null);

    const r = await wendeImportAn(t.db, csv, { loeschen: [], loeschenBestaetigt: false, austritteBestaetigt: false, dateiname: 'a.csv' }, null);
    assert.ok(r.angewendet);
    const vorher = await zeilen(t.db, 'SELECT * FROM person ORDER BY clubdesk_id');
    const r2 = await wendeImportAn(t.db, csv, { loeschen: [], loeschenBestaetigt: false, austritteBestaetigt: false, dateiname: 'a.csv' }, null);
    assert.ok(r2.angewendet);
    if (r2.angewendet) {
      assert.equal(r2.zusammenfassung.neu, 0);
      assert.equal(r2.zusammenfassung.geaendert, 0);
    }
    assert.deepEqual(await zeilen(t.db, 'SELECT * FROM person ORDER BY clubdesk_id'), vorher);
    const [p1] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 1');
    assert.equal(p1.nachname, 'Neu');
    assert.equal(p1.geburtsdatum, '2008-02-01');
  } finally {
    await t.ende();
  }
});
