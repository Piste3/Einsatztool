// T07: Formular mit Schicht, die nicht publiziert ist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, zeilen } from './hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { setzePubliziert } from '../src/domain/schicht.js';

test('T07 Unpublizierte Schicht wird abgewiesen, kein Eintrag', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Intern', inTagen(4, 8), inTagen(4, 12));
    await setzePubliziert(t.db, s.schichtId, false);
    await assert.rejects(
      verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', email: 'lea@example.ch', schichten: [String(s.schichtId)] }),
      /nicht mehr verfügbar/,
    );
    assert.equal((await zeilen(t.db, 'SELECT * FROM anmeldung')).length, 0);
  } finally {
    await t.ende();
  }
});
