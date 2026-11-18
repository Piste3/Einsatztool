// T15: ICS-Export einer Schicht, danach ein zweiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen } from './hilfe.js';
import { erzeugeIcs, icsVermerk, vermerkeIcsExport, icsDateiname } from '../src/domain/ics.js';
import { ladeSchicht } from '../src/domain/schicht.js';
import { schreibe } from '../src/db/db.js';

test('T15 ICS hat CRLF, gefaltete Zeilen, UTC-Zeiten. Der zweite Export kennt den ersten', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Basler Stadtlauf, Schicht; Test', inTagen(6, 7), inTagen(6, 13), 'Marktplatz (Tram 1,2,14,15)');
    await schreibe(t.db, 'UPDATE schicht SET bemerkung_extern = ? WHERE id = ?', ['Bitte pünktlich erscheinen. '.repeat(8), s.schichtId]);
    const schicht = await ladeSchicht(t.db, s.schichtId);
    const ics = erzeugeIcs(schicht);
    assert.ok(ics.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'Jedes Zeilenende ist CRLF');
    for (const z of ics.split('\r\n')) assert.ok(Buffer.byteLength(z, 'utf8') <= 75, `Zeile zu lang: ${z}`);
    assert.ok(ics.includes('\r\n '), 'Gefaltete Zeile beginnt mit Leerzeichen');
    assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
    assert.match(ics, /DTEND:\d{8}T\d{6}Z/);
    assert.match(ics, /SUMMARY:Basler Stadtlauf\\, Schicht\\; Test/);
    assert.equal(icsDateiname(schicht), 'Basler_Stadtlauf_Schicht_Test.ics');

    assert.equal(await icsVermerk(t.db, s.schichtId), undefined);
    await vermerkeIcsExport(t.db, s.schichtId, null);
    const v = await icsVermerk(t.db, s.schichtId);
    assert.ok(v?.exportiert_am);
  } finally {
    await t.ende();
  }
});
