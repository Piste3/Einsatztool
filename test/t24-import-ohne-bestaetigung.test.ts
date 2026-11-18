// T24: Import ohne Bestätigung der Rückfrage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { erstelleVorschau, wendeImportAn } from '../src/domain/import-clubdesk.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';

test('T24 Ohne Bestätigung löscht das Tool nichts; Person mit künftiger Anmeldung ist nicht löschbar', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { nachname: 'Bleibt' });
    await person(t.db, 2, { nachname: 'Zukunft' });
    await person(t.db, 3, { nachname: 'Fehlt' });
    const s = await einsatz(t.db, 'Bald', inTagen(3, 8), inTagen(3, 12));
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'angemeldet', kanal: 'telefon' }, null);
    const csv = clubdeskCsv([{ id: 1, vorname: 'A', nachname: 'Bleibt' }]);

    const v = await erstelleVorschau(t.db, csv);
    assert.deepEqual(v.entferntOhneZukunft.map((e) => e.clubdesk_id), [3]);
    assert.ok(!v.entferntOhneZukunft.some((e) => e.clubdesk_id === 2));

    // Entscheid Yann: ohne Bestätigung zeigt das Tool die Vorschau erneut und ändert nichts.
    const r = await wendeImportAn(t.db, csv, { loeschen: [3], loeschenBestaetigt: false, austritteBestaetigt: false, dateiname: null }, null);
    assert.equal(r.angewendet, false);
    const p = await zeilen(t.db, 'SELECT clubdesk_id, nachname, geloescht_am FROM person ORDER BY clubdesk_id');
    assert.deepEqual(p.map((x) => [x.clubdesk_id, x.nachname, x.geloescht_am]), [
      [1, 'Bleibt', null],
      [2, 'Zukunft', null],
      [3, 'Fehlt', null],
    ]);

    // Auch mit Bestätigung bleibt die Person mit künftiger Anmeldung erhalten.
    await wendeImportAn(t.db, csv, { loeschen: [2, 3], loeschenBestaetigt: true, austritteBestaetigt: false, dateiname: null }, null);
    const [p2] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 2');
    assert.equal(p2.geloescht_am, null);
  } finally {
    await t.ende();
  }
});
