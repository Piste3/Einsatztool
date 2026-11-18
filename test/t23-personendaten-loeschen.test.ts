// T23: Personendaten einer Person löschen (nach Bestätigung).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { clubdeskCsv } from './csv-hilfe.js';
import { wendeImportAn } from '../src/domain/import-clubdesk.js';
import { schreibe } from '../src/db/db.js';
import { personenListe } from '../src/domain/personen.js';
import { anrufliste } from '../src/domain/listen.js';
import { personenCsv } from '../src/domain/export.js';

test('T23 Löschen leert Personenfelder, behält die ID; spätere CSV füllt sie wieder', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Bleibt' });
    await person(t.db, 2, { vorname: 'Ben', nachname: 'Weg', email: 'ben@web.kkb.ch', telefon: '0791234567', strasse: 'Gasse 1' });
    // Vergangene Anmeldung mit Bemerkung und Mail.
    const s = await einsatz(t.db, 'Alt', inTagen(-20, 8), inTagen(-20, 12));
    await schreibe(
      t.db,
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, email_text, status, kanal, bemerkung, erstellt_am, geaendert_am)
       VALUES (?, 2, 'Ben Weg', 'ben@web.kkb.ch', 'bestaetigt', 'telefon', 'Bemerkung', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [s.schichtId],
    );
    const csv = clubdeskCsv([{ id: 1, vorname: 'Anna', nachname: 'Bleibt' }]);
    const r = await wendeImportAn(t.db, csv, { loeschen: [2], loeschenBestaetigt: true, austritteBestaetigt: false, dateiname: null }, null);
    assert.ok(r.angewendet);

    const [p] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 2');
    assert.equal(p.clubdesk_id, 2);
    assert.ok(p.geloescht_am);
    for (const feld of ['vorname', 'nachname', 'geburtsdatum', 'rang_id', 'email', 'telefon', 'telefon_privat', 'strasse', 'plz', 'ort', 'essenseinschraenkung']) {
      assert.equal(p[feld], null, feld);
    }
    const [a] = await zeilen(t.db, 'SELECT * FROM anmeldung WHERE person_id = 2');
    assert.equal(a.name_text, 'Gelöschte Person 2');
    assert.equal(a.email_text, null);
    assert.equal(a.bemerkung, null);

    assert.ok(!(await personenListe(t.db)).some((x) => x.clubdesk_id === 2));
    const neu = await einsatz(t.db, 'Neu', inTagen(5, 8), inTagen(5, 12));
    assert.ok(!(await anrufliste(t.db, neu.schichtId, true)).zeilen.some((x) => x.clubdesk_id === 2));
    assert.doesNotMatch(await personenCsv(t.db), /Weg/);

    // Eine spätere CSV mit derselben ID füllt die Felder wieder.
    const wieder = clubdeskCsv([{ id: 1, vorname: 'Anna', nachname: 'Bleibt' }, { id: 2, vorname: 'Ben', nachname: 'Zurück' }]);
    await wendeImportAn(t.db, wieder, { loeschen: [], loeschenBestaetigt: false, austritteBestaetigt: false, dateiname: null }, null);
    const [p2] = await zeilen(t.db, 'SELECT * FROM person WHERE clubdesk_id = 2');
    assert.equal(p2.nachname, 'Zurück');
    assert.equal(p2.geloescht_am, null);
  } finally {
    await t.ende();
  }
});
