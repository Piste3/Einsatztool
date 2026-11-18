// T22: Import einer CSV mit IBAN, BIC, Notfallkontakt, Bemerkungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { wendeImportAn } from '../src/domain/import-clubdesk.js';

test('T22 Die Datenbank enthält keinen Wert aus IBAN, BIC, Notfallkontakt, Bemerkungen', async () => {
  const t = await neueDatenbank();
  try {
    const csv = clubdeskCsv([
      { id: 1, vorname: 'Anna', nachname: 'Test', iban: 'CH9300762011623852957', notfall: 'Mutter 079 999 88 77', bemerkung: 'GEHEIM-BEMERKUNG' },
    ]);
    const r = await wendeImportAn(t.db, csv, { loeschen: [], loeschenBestaetigt: false, austritteBestaetigt: false, dateiname: 'test.csv' }, null);
    assert.ok(r.angewendet);
    const gesucht = ['CH9300762011623852957', 'POFICHBEXXX', 'Mutter 079 999 88 77', 'GEHEIM-BEMERKUNG'];
    const spalten = await zeilen(
      t.db,
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('varchar','text','mediumtext','longtext','char')`,
    );
    assert.ok(spalten.length > 10);
    for (const { t: tabelle, c: spalte } of spalten) {
      for (const wert of gesucht) {
        const z = await zeilen(t.db, `SELECT COUNT(*) AS n FROM \`${tabelle}\` WHERE \`${spalte}\` LIKE ?`, [`%${wert}%`]);
        assert.equal(Number(z[0].n), 0, `${wert} in ${tabelle}.${spalte}`);
      }
    }
    const [p] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 1');
    assert.equal(p.nachname, 'Test');
  } finally {
    await t.ende();
  }
});
