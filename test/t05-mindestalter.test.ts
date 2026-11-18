// T05: Mindestalter 16. Person wird am Starttag der Schicht 16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person } from './hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { warnungenFuerAnmeldung } from '../src/domain/warnungen.js';
import { schreibe } from '../src/db/db.js';
import { lokalesDatum, plusTage } from '../src/domain/zeit.js';

test('T05 Geburtstag am Starttag: keine Warnung. Einen Tag später geboren: W_ALTER', async () => {
  const t = await neueDatenbank();
  try {
    const start = inTagen(20, 8);
    const s = await einsatz(t.db, 'Stadtlauf', start, inTagen(20, 14));
    await schreibe(t.db, 'UPDATE schicht SET min_alter = 16 WHERE id = ?', [s.schichtId]);
    const tag = lokalesDatum(start);
    const geb16 = `${Number(tag.slice(0, 4)) - 16}${tag.slice(4)}`;
    await person(t.db, 1, { geburtsdatum: geb16 });
    await person(t.db, 2, { geburtsdatum: plusTage(geb16, 1) });
    const a1 = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const a2 = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'angemeldet', kanal: 'telefon' }, null);
    assert.ok(!(await warnungenFuerAnmeldung(t.db, a1)).some((w) => w.code === 'W_ALTER'));
    assert.ok((await warnungenFuerAnmeldung(t.db, a2)).some((w) => w.code === 'W_ALTER'));
  } finally {
    await t.ende();
  }
});
