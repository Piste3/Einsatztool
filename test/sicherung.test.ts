// Datenbankkopie schreiben und wieder einspielen (Tagesexport, Update, Wiederherstellen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { schreibeSicherung, spieleSicherungEin } from '../src/db/sicherung.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';

test('Sicherung: schreiben und in eine leere Datenbank einspielen', async () => {
  const quelle = await neueDatenbank();
  const ziel = await neueDatenbank();
  const ordner = mkdtempSync(join(tmpdir(), 'ep-sicherung-'));
  try {
    await person(quelle.db, 1, { vorname: 'Zoë', nachname: "O'Brien\nZeile", essenseinschraenkung: 'vegan; «ohne» Nüsse' });
    const s = await einsatz(quelle.db, 'Einsatz \\ Test', inTagen(5), inTagen(5, 12));
    await setzeAnmeldung(quelle.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon', bemerkung: 'a;\r\nb' }, null);
    const datei = join(ordner, 'datenbank-test.sql');
    await schreibeSicherung(quelle.db, datei);

    const c = await ziel.db.getConnection();
    try {
      await spieleSicherungEin(c, datei);
    } finally {
      c.release();
    }
    for (const t of ['person', 'einsatz', 'schicht', 'anmeldung', 'status_log', 'rolle', 'schema_version']) {
      assert.deepEqual(await zeilen(ziel.db, `SELECT * FROM ${t} ORDER BY 1`), await zeilen(quelle.db, `SELECT * FROM ${t} ORDER BY 1`), t);
    }
  } finally {
    rmSync(ordner, { recursive: true, force: true });
    await quelle.ende();
    await ziel.ende();
  }
});
