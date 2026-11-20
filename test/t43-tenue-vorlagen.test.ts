// T43 (Wunsch Yann 20.11.2026): Tenue-Vorlagen in Admin › Einstellungen › Stammdaten.
// Schicht und Einsatz wählen eine Vorlage. Der Text wird kopiert und bleibt bearbeitbar. **fett** ergibt Fettdruck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTagen, neueDatenbank, einsatz, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereEinsatz, ladeEinsatz } from '../src/domain/einsatz.js';
import { aendereSchicht, ladeSchicht } from '../src/domain/schicht.js';
import { legeTenueVorlageAn, loescheTenueVorlage, ordneTenueVorlagen, tenueVorlagen } from '../src/domain/tenue.js';
import { lokalesDatum } from '../src/domain/zeit.js';

test('T43 Tenue-Vorlagen: anlegen, wählen, Text bleibt, Löschen ändert keine Schicht', async () => {
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

    // Nur der Admin legt Vorlagen an.
    assert.equal((await sende(aufgebot.cookie, '/admin/tenue', [['_csrf', aufgebot.csrf], ['aktion', 'anlegen'], ['name', 'X'], ['text', 'Y']])).status, 403);
    const r = await sende(admin.cookie, '/admin/tenue', [['_csrf', admin.csrf], ['aktion', 'anlegen'], ['name', 'Orange'], ['text', 'Orange, VD-Material, **VD-Jacke zwingend!**']]);
    assert.equal(r.status, 303);
    await legeTenueVorlageAn(t.db, 'Ausgang', 'Ausgangsuniform');
    await assert.rejects(legeTenueVorlageAn(t.db, 'Orange', 'doppelt'), /gibt es schon/);
    await assert.rejects(legeTenueVorlageAn(t.db, 'Leer', ''), /Text/);
    let liste = await tenueVorlagen(t.db);
    assert.deepEqual(liste.map((v) => v.name), ['Orange', 'Ausgang']);

    // Reihenfolge durch Ziehen. Eine veraltete Liste ändert nichts.
    await ordneTenueVorlagen(t.db, [liste[1].id, liste[0].id]);
    liste = await tenueVorlagen(t.db);
    assert.deepEqual(liste.map((v) => v.name), ['Ausgang', 'Orange']);
    await assert.rejects(ordneTenueVorlagen(t.db, [liste[0].id]), /inzwischen geändert/);
    const orange = liste.find((v) => v.name === 'Orange')!;

    // Einstellungen zeigen die Vorlage mit Fettdruck in der Vorschau.
    const einst = await (await fetch(`${app.url}/admin/einstellungen`, { headers: { cookie: admin.cookie } })).text();
    assert.match(einst, /Tenue-Vorlagen/);
    assert.match(einst, /<strong>VD-Jacke zwingend!<\/strong>/);
    assert.match(einst, /data-ordnen="tenueliste"/);

    // Schicht: Auswahl ohne Skript ersetzt den Text durch die Vorlage.
    const { einsatzId, schichtId } = await einsatz(t.db, 'Herbstmesse', inTagen(10, 8), inTagen(10, 12));
    const s = await ladeSchicht(t.db, schichtId);
    const basis = { name: s.name, start_datum: lokalesDatum(s.start_zeit), start_zeit: '08:00', end_datum: '', end_zeit: '12:00' };
    await aendereSchicht(t.db, schichtId, { ...basis, tenue: 'alt', tenue_vorlage: String(orange.id) });
    assert.equal((await ladeSchicht(t.db, schichtId)).tenue, 'Orange, VD-Material, **VD-Jacke zwingend!**');

    // Mit Skript ist die Auswahl leer: Der Text im Feld gilt, auch nach einer Änderung von Hand.
    await aendereSchicht(t.db, schichtId, { ...basis, tenue: 'Orange, **VD-Jacke**, Handschuhe', tenue_vorlage: '' });
    assert.equal((await ladeSchicht(t.db, schichtId)).tenue, 'Orange, **VD-Jacke**, Handschuhe');
    await assert.rejects(aendereSchicht(t.db, schichtId, { ...basis, tenue: 'x', tenue_vorlage: '999999' }), /gibt es nicht mehr/);

    // Einsatz: gleiche Regel.
    const e = await ladeEinsatz(t.db, einsatzId);
    await aendereEinsatz(t.db, einsatzId, { name: e.name, ort: e.ort, tenue_vorlage: String(orange.id) });
    assert.equal((await ladeEinsatz(t.db, einsatzId)).tenue, orange.text);

    // Die Seiten zeigen die Auswahl und den Fettdruck.
    const schichten = await (await fetch(`${app.url}/einsaetze/${einsatzId}/schichten`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(schichten, /name="tenue_vorlage"/);
    assert.match(schichten, new RegExp(`data-text="Orange, VD-Material, \\*\\*VD-Jacke zwingend!\\*\\*"`));
    const uebersicht = await (await fetch(`${app.url}/einsaetze/${einsatzId}`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(uebersicht, /<strong>VD-Jacke zwingend!<\/strong>/);
    const bearbeiten = await (await fetch(`${app.url}/einsaetze/${einsatzId}/bearbeiten`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(bearbeiten, /name="tenue_vorlage"/);

    // Löschen der Vorlage ändert keine Schicht und keinen Einsatz.
    await loescheTenueVorlage(t.db, orange.id);
    assert.equal((await ladeEinsatz(t.db, einsatzId)).tenue, orange.text);
    const [n] = await zeilen(t.db, 'SELECT COUNT(*) AS n FROM tenue_vorlage');
    assert.equal(Number(n.n), 1);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
