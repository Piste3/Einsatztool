// T10: Dieselbe Person meldet sich zweimal für dieselbe Schicht an.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { aendereAnmeldung } from '../src/domain/anmeldung.js';

test('T10 Zweite Anmeldung: ein Eintrag, Status bleibt', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Muster' });
    const s = await einsatz(t.db, 'Einsatz', inTagen(3, 8), inTagen(3, 12));
    const eingabe = { vorname: 'Anna', nachname: 'Muster', email: 'a@example.ch', schichten: [String(s.schichtId)] };
    const r1 = await verarbeiteFormular(t.db, eingabe);
    await aendereAnmeldung(t.db, r1.anmeldungIds[0], { status: 'bestaetigt' }, null);
    await verarbeiteFormular(t.db, { ...eingabe, bemerkung: 'Komme mit dem Velo' });
    const a = await zeilen(t.db, 'SELECT * FROM anmeldung');
    assert.equal(a.length, 1);
    assert.equal(a[0].status, 'bestaetigt');
    assert.match(a[0].bemerkung, /Komme mit dem Velo/);
    const log = await zeilen(t.db, "SELECT * FROM status_log WHERE aktion = 'bemerkung'");
    assert.equal(log.length, 1);
  } finally {
    await t.ende();
  }
});
