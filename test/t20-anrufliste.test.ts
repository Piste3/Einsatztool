// T20: Anrufliste mit Mindestalter. Sammelstatus für zwei Personen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anrufliste } from '../src/domain/listen.js';
import { sammelstatus } from '../src/domain/anmeldung.js';
import { schreibe } from '../src/db/db.js';

function geburtstag(jahreAlt: number): string {
  const d = new Date();
  return `${d.getUTCFullYear() - jahreAlt}-01-01`;
}

test('T20 Anrufliste blendet zu junge Personen aus; Sammelstatus setzt Nachricht gesendet mit WhatsApp', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Einsatz', inTagen(30, 8), inTagen(30, 12));
    await schreibe(t.db, 'UPDATE schicht SET min_alter = 16 WHERE id = ?', [s.schichtId]);
    await person(t.db, 1, { geburtsdatum: geburtstag(20) });
    await person(t.db, 2, { geburtsdatum: geburtstag(18) });
    await person(t.db, 3, { geburtsdatum: geburtstag(12) });

    const r = await anrufliste(t.db, s.schichtId, false);
    assert.deepEqual(r.zeilen.map((z) => z.clubdesk_id).sort(), [1, 2]);
    assert.equal(r.ausgeblendet, 1);
    const alle = await anrufliste(t.db, s.schichtId, true);
    assert.equal(alle.zeilen.length, 3);
    assert.equal(alle.zeilen.find((z) => z.clubdesk_id === 3)?.passt, false);

    await sammelstatus(t.db, s.schichtId, [1, 2], 'nachricht_gesendet', 'whatsapp', null);
    const a = await zeilen(t.db, 'SELECT person_id, status, kanal FROM anmeldung WHERE schicht_id = ? ORDER BY person_id', [s.schichtId]);
    assert.deepEqual(a.map((x) => [x.person_id, x.status, x.kanal]), [
      [1, 'nachricht_gesendet', 'whatsapp'],
      [2, 'nachricht_gesendet', 'whatsapp'],
    ]);
    const log = await zeilen(t.db, "SELECT COUNT(*) AS n FROM status_log WHERE aktion = 'erstellt'");
    assert.equal(Number(log[0].n), 2);
    // Personen mit «Nachricht gesendet» bleiben in der Anrufliste.
    const nachher = await anrufliste(t.db, s.schichtId, false);
    assert.equal(nachher.zeilen.length, 2);
  } finally {
    await t.ende();
  }
});
