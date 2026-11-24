// T50 (Wunsch Yann 24.11.2026): Eine Tenue-Vorlage ist der Standard.
// Ein neuer Einsatz und seine Standardschicht übernehmen ihren Text. Höchstens eine Vorlage ist Standard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTagen, neueDatenbank } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereEinsatz, erstelleEinsatz, ladeEinsatz } from '../src/domain/einsatz.js';
import { erstelleSchicht, schichtenVonEinsatz } from '../src/domain/schicht.js';
import { legeTenueVorlageAn, loescheTenueVorlage, setzeStandardTenue, standardTenue, tenueVorlagen } from '../src/domain/tenue.js';
import { lokalesDatum } from '../src/domain/zeit.js';

test('T50 Tenue-Standard: neuer Einsatz übernimmt die Standard-Vorlage', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const admin = await anmelden(t.db, 'admin');
    const aufgebot = await anmelden(t.db, 'aufgebot');
    const sende = (cookie: string, pfad: string, felder: [string, string][]) => fetch(`${app.url}${pfad}`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(felder),
    });
    const datum = lokalesDatum(inTagen(20).toISOString());

    // Ohne Standard bleibt das Tenue leer.
    const ohne = await erstelleEinsatz(t.db, { name: 'Ohne', start_datum: datum, start_zeit: '', end_datum: '', end_zeit: '' }, null);
    assert.equal((await ladeEinsatz(t.db, ohne)).tenue, null);

    await legeTenueVorlageAn(t.db, 'Orange', 'Orange, **VD-Jacke**');
    await legeTenueVorlageAn(t.db, 'Ausgang', 'Ausgangsuniform');
    const [orange, ausgang] = await tenueVorlagen(t.db);
    assert.equal(await standardTenue(t.db), null);

    // Nur der Admin setzt den Standard.
    assert.equal((await sende(aufgebot.cookie, '/admin/tenue', [['_csrf', aufgebot.csrf], ['aktion', 'standard'], ['id', String(orange.id)], ['an', '1']])).status, 403);
    assert.equal((await sende(admin.cookie, '/admin/tenue', [['_csrf', admin.csrf], ['aktion', 'standard'], ['id', String(orange.id)], ['an', '1']])).status, 303);
    assert.equal((await standardTenue(t.db))?.name, 'Orange');

    // Höchstens eine Vorlage ist Standard.
    await setzeStandardTenue(t.db, ausgang.id, true);
    assert.deepEqual((await tenueVorlagen(t.db)).map((v) => [v.name, Number(v.standard)]), [['Orange', 0], ['Ausgang', 1]]);
    await setzeStandardTenue(t.db, orange.id, true);
    await assert.rejects(setzeStandardTenue(t.db, 999999, true), /nicht gefunden/);

    // Neuer Einsatz: Einsatz und Standardschicht haben den Text der Vorlage.
    const id = await erstelleEinsatz(t.db, { name: 'Herbstmesse', start_datum: datum, start_zeit: '', end_datum: '', end_zeit: '' }, null);
    assert.equal((await ladeEinsatz(t.db, id)).tenue, orange.text);
    assert.deepEqual((await schichtenVonEinsatz(t.db, id)).map((s) => s.tenue), [orange.text]);

    // Eine neue Schicht übernimmt das Tenue vom Einsatz. Eine Änderung am Einsatz vererbt sich weiter.
    await erstelleSchicht(t.db, id, { name: 'Abend', start_datum: datum, start_zeit: '18:00', end_datum: '', end_zeit: '22:00' });
    const e = await ladeEinsatz(t.db, id);
    await aendereEinsatz(t.db, id, { name: e.name, ort: e.ort, tenue: 'Neu' });
    assert.deepEqual((await schichtenVonEinsatz(t.db, id)).map((s) => s.tenue), ['Neu', 'Neu']);

    // Die Seiten zeigen den Standard.
    const einst = await (await fetch(`${app.url}/admin/einstellungen`, { headers: { cookie: admin.cookie } })).text();
    assert.match(einst, /<th>Standard<\/th>/);
    const neu = await (await fetch(`${app.url}/einsaetze/neu`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(neu, /Tenue: Vorlage «Orange» \(Standard\)/);
    const bearbeiten = await (await fetch(`${app.url}/einsaetze/${id}/bearbeiten`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(bearbeiten, />Orange \(Standard\)</);

    // Standard ausschalten: Ein neuer Einsatz hat wieder kein Tenue. Bestehende Einsätze bleiben.
    await setzeStandardTenue(t.db, orange.id, false);
    const danach = await erstelleEinsatz(t.db, { name: 'Danach', start_datum: datum, start_zeit: '', end_datum: '', end_zeit: '' }, null);
    assert.equal((await ladeEinsatz(t.db, danach)).tenue, null);

    // Löschen der Standard-Vorlage: Danach gibt es keinen Standard.
    await setzeStandardTenue(t.db, ausgang.id, true);
    await loescheTenueVorlage(t.db, ausgang.id);
    assert.equal(await standardTenue(t.db), null);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
