// T18: Einsatz kopieren mit neuem Startdatum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, person, zeilen } from './hilfe.js';
import { erstelleEinsatz, kopiereEinsatz, vorgabeKopie, vorgabeName } from '../src/domain/einsatz.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

test('T18 Zeiten verschoben, Uhrzeit gleich (auch über die Sommerzeit), publiziert = 0, keine Anmeldungen', async () => {
  const t = await neueDatenbank();
  try {
    // Winterzeit im Original, Sommerzeit in der Kopie.
    const id = await erstelleEinsatz(t.db, { name: 'Fasnacht 2026', start_datum: '2026-02-23', start_zeit: '04:00', end_datum: '2026-02-23', end_zeit: '10:00' }, null);
    await erstelleSchicht(t.db, id, { name: 'Nacht', start_datum: '2026-02-24', start_zeit: '22:00', end_datum: '2026-02-25', end_zeit: '02:00', rollen: { Busfahrer: '2' } });
    await person(t.db, 1);
    const [erste] = await zeilen(t.db, 'SELECT id FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit', [id]);
    await setzeAnmeldung(t.db, { schichtId: erste.id, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);

    assert.equal(vorgabeName('Herbstmesse 2026'), 'Herbstmesse 2027');
    assert.equal(vorgabeName('slowUp'), 'slowUp');
    const vorgabe = await vorgabeKopie(t.db, id);
    assert.deepEqual(vorgabe, { name: 'Fasnacht 2027', startDatum: '2027-02-23' });

    const neu = await kopiereEinsatz(t.db, id, { name: 'Sommer-Test', start_datum: '2026-07-06' }, null);
    const s = await zeilen(t.db, 'SELECT * FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit', [neu]);
    assert.equal(s.length, 2);
    assert.equal(lokalesDatum(s[0].start_zeit), '2026-07-06');
    assert.equal(lokaleZeit(s[0].start_zeit), '04:00');
    assert.equal(lokaleZeit(s[0].end_zeit), '10:00');
    assert.equal(lokalesDatum(s[1].start_zeit), '2026-07-07');
    assert.equal(lokaleZeit(s[1].start_zeit), '22:00');
    assert.equal(lokalesDatum(s[1].end_zeit), '2026-07-08');
    assert.equal(lokaleZeit(s[1].end_zeit), '02:00');
    assert.ok(s.every((x) => Number(x.publiziert) === 0));
    const rollen = await zeilen(t.db, 'SELECT * FROM schicht_rolle WHERE schicht_id = ?', [s[1].id]);
    assert.equal(rollen.length, 1);
    assert.equal((await zeilen(t.db, 'SELECT * FROM anmeldung a JOIN schicht s ON s.id = a.schicht_id WHERE s.einsatz_id = ?', [neu])).length, 0);
  } finally {
    await t.ende();
  }
});
