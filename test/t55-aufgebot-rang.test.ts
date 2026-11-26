// T55 (Wunsch Yann 26.11.2026): Schalter «Aufgebot» je Rang. Aus = kein Brief für Personen mit diesem Rang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang } from './hilfe.js';
import { aufgebotDaten } from '../src/domain/aufgebot-vorlage.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { raenge, setzeRangAufgebot } from '../src/domain/stammdaten.js';

test('T55 Rang ohne Aufgebot: kein Brief, Einsatzleitung bleibt, Vorgabe ein, Brief für eine Person geht', async () => {
  const t = await neueDatenbank();
  try {
    const wm = await rang(t.db, 'Wm', 5);
    const ks = await rang(t.db, 'KS', 1);
    const adresse = { strasse: 'Weg 1', plz: '4000', ort: 'Basel' };
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Leiterin', rang_id: wm, ...adresse });
    await person(t.db, 2, { vorname: 'Tim', nachname: 'Kadett', rang_id: ks, ...adresse });
    await person(t.db, 3, { vorname: 'Ida', nachname: 'Ohnerang', ...adresse });
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(14, 7), inTagen(14, 15), 'Marktplatz');
    for (const id of [1, 2, 3]) {
      await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: id, status: 'bestaetigt', kanal: 'telefon', rolle: id === 1 ? 'Einsatzleitung' : null }, null);
    }

    // Vorgabe: Jeder Rang erhält ein Aufgebot. Es ändert sich nichts.
    assert.ok((await raenge(t.db)).every((r) => Number(r.aufgebot) === 1));
    let a = await aufgebotDaten(t.db, s.schichtId);
    assert.equal(a.briefe.length, 3);
    assert.deepEqual(a.ohneBrief, []);

    await setzeRangAufgebot(t.db, wm, false);
    assert.equal(Number((await raenge(t.db)).find((r) => r.id === wm)!.aufgebot), 0);
    a = await aufgebotDaten(t.db, s.schichtId);
    assert.deepEqual(a.briefe.map((b) => b.personId).sort(), [2, 3]);
    assert.deepEqual(a.ohneBrief, [{ personId: 1, name: 'Wm Eva Leiterin' }]);
    assert.equal(a.einsatzleitung.length, 1, 'Die Einsatzleitung steht weiter im Brief.');

    // Ein Brief für eine bestimmte Person geht immer.
    a = await aufgebotDaten(t.db, s.schichtId, 1);
    assert.deepEqual(a.briefe.map((b) => b.personId), [1]);

    // «Alle Briefe drucken» nimmt auch Personen mit ausgeschaltetem Rang.
    a = await aufgebotDaten(t.db, s.schichtId, null, new Date(), { alleRaenge: true });
    assert.equal(a.briefe.length, 3);
    assert.deepEqual(a.ohneBrief, []);

    await setzeRangAufgebot(t.db, wm, true);
    a = await aufgebotDaten(t.db, s.schichtId);
    assert.equal(a.briefe.length, 3);
  } finally {
    await t.ende();
  }
});
