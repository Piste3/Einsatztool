// T31: Formular ohne E-Mail und ohne Essenseinschränkungen, Bemerkung je Einsatz (Wunsch Yann 19.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';

test('T31 Formular: keine E-Mail, kein Essen, eine Bemerkung je Einsatz', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann' });
    const a = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18));
    const b = await einsatz(t.db, 'Stadtlauf', inTagen(6, 12), inTagen(6, 18));

    // Das Formular fragt weder E-Mail noch Essenseinschränkungen. Jeder Einsatz hat ein eigenes Feld «Bemerkung».
    const formular = await (await fetch(`${app.url}/anmeldung`)).text();
    assert.doesNotMatch(formular, /name="email"/);
    assert.doesNotMatch(formular, /name="essen"/);
    assert.match(formular, new RegExp(`name="bemerkung_${a.einsatzId}"`));
    assert.match(formular, new RegExp(`name="bemerkung_${b.einsatzId}"`));

    // Bekannte Person ohne E-Mail: Zuordnung über den Namen. Jede Schicht erhält die Bemerkung ihres Einsatzes.
    const r = await verarbeiteFormular(t.db, {
      vorname: 'Nina', nachname: 'Baumann',
      bemerkungen: { [String(a.einsatzId)]: 'Erst ab 13 Uhr', [String(b.einsatzId)]: '' },
      schichten: [String(a.schichtId), String(b.schichtId)],
    });
    assert.equal(r.personId, 7);
    const eintraege = await zeilen(t.db, 'SELECT schicht_id, bemerkung, email_text FROM anmeldung ORDER BY schicht_id');
    assert.deepEqual(eintraege.map((e) => [e.schicht_id, e.bemerkung, e.email_text]), [
      [a.schichtId, 'Erst ab 13 Uhr', null],
      [b.schichtId, null, null],
    ]);

    // Unbekannte Person ohne E-Mail: Eintrag ohne Adresse. Ein zweites Absenden ergänzt nur die Bemerkung.
    const u1 = await verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', schichten: [String(a.schichtId)] });
    assert.equal(u1.personId, null);
    const u2 = await verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', bemerkungen: { [String(a.einsatzId)]: 'Bringe Velo' }, schichten: [String(a.schichtId)] });
    assert.deepEqual(u2.anmeldungIds, u1.anmeldungIds);
    const [lea] = await zeilen(t.db, 'SELECT email_text, bemerkung FROM anmeldung WHERE id = ?', [u1.anmeldungIds[0]]);
    assert.deepEqual([lea.email_text, lea.bemerkung], [null, 'Bringe Velo']);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
