// T09: Status, Rolle, Kanal oder Bemerkung ändern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { setzeAnmeldung, aendereAnmeldung } from '../src/domain/anmeldung.js';
import { schreibe } from '../src/db/db.js';

test('T09 Jede Änderung erzeugt einen status_log-Eintrag mit Zeit, Benutzer, Alt- und Neuwert', async () => {
  const t = await neueDatenbank();
  try {
    const b = await schreibe(t.db, "INSERT INTO benutzer (name, email, entra_oid, rolle) VALUES ('Yann', 'y@kkb.ch', 'oid-1', 'admin')");
    const benutzer = b.insertId;
    await person(t.db, 1);
    const s = await einsatz(t.db, 'Einsatz', inTagen(3, 8), inTagen(3, 12));
    const id = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, benutzer);
    await aendereAnmeldung(t.db, id, { status: 'unsicher' }, benutzer);
    await aendereAnmeldung(t.db, id, { rolle: 'Busfahrer' }, benutzer);
    await aendereAnmeldung(t.db, id, { kanal: 'whatsapp' }, benutzer);
    await aendereAnmeldung(t.db, id, { bemerkung: 'Antwort bis Freitag' }, benutzer);
    await aendereAnmeldung(t.db, id, { bemerkung: 'Antwort bis Freitag' }, benutzer); // keine Änderung
    const log = await zeilen(t.db, 'SELECT * FROM status_log WHERE anmeldung_id = ? ORDER BY id', [id]);
    assert.deepEqual(
      log.map((l) => [l.aktion, l.alt_wert, l.neu_wert]),
      [
        ['erstellt', null, 'angemeldet'],
        ['status', 'angemeldet', 'unsicher'],
        ['rolle', null, 'Busfahrer'],
        ['kanal', 'telefon', 'whatsapp'],
        ['bemerkung', null, 'Antwort bis Freitag'],
      ],
    );
    for (const l of log) {
      assert.equal(l.benutzer_id, benutzer);
      assert.match(l.zeit, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  } finally {
    await t.ende();
  }
});
