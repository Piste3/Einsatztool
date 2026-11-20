// T40: Filter je Benutzer (Wunsch Yann). Rückmeldungen und Einsätze merken sich die Filter des Benutzers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';

test('T40 Filter: gespeichert je Benutzer, Live-Abfrage speichert nicht, Zurücksetzen löscht', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18), 'Claraplatz');
    const a = await anmelden(t.db, 'admin');
    const b = await anmelden(t.db, 'aufgebot');
    const hole = async (cookie: string, pfad: string, kopf: Record<string, string> = {}) =>
      (await fetch(`${app.url}${pfad}`, { headers: { cookie, ...kopf } })).text();
    const gewaehlt = (seite: string, wert: string) => new RegExp(`<option value="${wert}" selected`).test(seite);

    // Benutzer A wählt 12 Monate und Sortierung nach Name.
    await hole(a.cookie, '/rueckmeldungen?monate=12&sort=name&suche=Nina');
    const aSpaeter = await hole(a.cookie, '/rueckmeldungen');
    assert.ok(gewaehlt(aSpaeter, '12'), 'A sieht seinen Zeitraum');
    assert.ok(gewaehlt(aSpaeter, 'name'), 'A sieht seine Sortierung');
    assert.match(aSpaeter, /value="Nina"/);
    assert.match(aSpaeter, /Filter zurücksetzen/);

    // Benutzer B sieht den Standard.
    const bSeite = await hole(b.cookie, '/rueckmeldungen');
    assert.ok(gewaehlt(bSeite, '3'));
    assert.doesNotMatch(bSeite, /Filter zurücksetzen/);

    // Eine Live-Abfrage mit anderen Filtern speichert nichts.
    await hole(a.cookie, '/rueckmeldungen?monate=1', { 'X-Live-Abfrage': '1' });
    assert.ok(gewaehlt(await hole(a.cookie, '/rueckmeldungen'), '12'));

    // Zurücksetzen löscht die gespeicherten Filter.
    const zurueck = await hole(a.cookie, '/rueckmeldungen?zuruecksetzen=1');
    assert.ok(gewaehlt(zurueck, '3'));
    assert.ok(gewaehlt(await hole(a.cookie, '/rueckmeldungen'), '3'));

    // Einsätze: Status-Filter bleibt, getrennt vom Archiv.
    await hole(a.cookie, '/einsaetze?status=entwurf&von=&bis=');
    assert.ok(gewaehlt(await hole(a.cookie, '/einsaetze'), 'entwurf'));
    assert.ok(gewaehlt(await hole(a.cookie, '/einsaetze?ansicht=archiv'), 'alle'));

    // Ungültige Werte gelten als Standard und richten keinen Schaden an.
    await hole(a.cookie, '/rueckmeldungen?monate=999&sort=%3Cscript%3E');
    const seite = await hole(a.cookie, '/rueckmeldungen');
    assert.ok(gewaehlt(seite, '3'));
    assert.doesNotMatch(seite, /<script>/);
    const [z] = (await t.db.query('SELECT COUNT(*) AS n FROM benutzer_filter')) as any;
    assert.equal(Number(z[0].n), 2);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
