// T14: Import entfernt mehr als max(5, 10 %) der Personen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, person, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { erstelleVorschau, wendeImportAn } from '../src/domain/import-clubdesk.js';

test('T14 Anwenden geht erst nach dem Ankreuzen des Kontrollkästchens', async () => {
  const t = await neueDatenbank();
  try {
    for (let i = 1; i <= 20; i++) await person(t.db, i);
    // 6 von 20 fehlen: mehr als max(5, 2).
    const csv = clubdeskCsv(Array.from({ length: 14 }, (_, i) => ({ id: i + 1, vorname: `Vorname${i + 1}`, nachname: `Nachname${i + 1}` })));
    const v = await erstelleVorschau(t.db, csv);
    assert.equal(v.vieleAustritte, true);
    const ohne = await wendeImportAn(t.db, csv, { loeschen: [15, 16], loeschenBestaetigt: true, austritteBestaetigt: false, dateiname: null }, null);
    assert.equal(ohne.angewendet, false);
    assert.equal((await zeilen(t.db, 'SELECT * FROM person WHERE geloescht_am IS NOT NULL')).length, 0);
    const mit = await wendeImportAn(t.db, csv, { loeschen: [15, 16], loeschenBestaetigt: true, austritteBestaetigt: true, dateiname: null }, null);
    assert.equal(mit.angewendet, true);
    assert.equal((await zeilen(t.db, 'SELECT * FROM person WHERE geloescht_am IS NOT NULL')).length, 2);
    // Fünf fehlende Personen sind noch keine ungewöhnliche Zahl.
    const csv5 = clubdeskCsv(Array.from({ length: 15 }, (_, i) => ({ id: i + 1, vorname: `Vorname${i + 1}`, nachname: `Nachname${i + 1}` })));
    await t.db.query('UPDATE person SET geloescht_am = NULL');
    assert.equal((await erstelleVorschau(t.db, csv5)).vieleAustritte, false);
  } finally {
    await t.ende();
  }
});
