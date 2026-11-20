// T42: Ränge und Rollen per Ziehen ordnen (Wunsch Yann 20.11.2026). Das Menü ⋮ (ein Platz) bleibt für Handy und Tastatur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, rang, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { legeRolleAn } from '../src/domain/stammdaten.js';

test('T42 Ziehen setzt die ganze Reihenfolge, eine veraltete Liste ändert nichts', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    // Oben = höchster Rang = grösste Zahl in «reihenfolge».
    const kpl = await rang(t.db, 'Kpl', 1);
    const wm = await rang(t.db, 'Wm', 2);
    const lt = await rang(t.db, 'Lt', 3);
    const vorher = await zeilen(t.db, 'SELECT name FROM rolle ORDER BY reihenfolge, name');
    await legeRolleAn(t.db, 'Funk', true);
    const rollenVorher = [...vorher.map((x) => x.name), 'Funk'];

    const admin = await anmelden(t.db, 'admin');
    const aufgebot = await anmelden(t.db, 'aufgebot');
    const sende = (cookie: string, pfad: string, felder: [string, string][]) => fetch(`${app.url}${pfad}`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(felder),
    });

    const seite = await (await fetch(`${app.url}/admin/einstellungen`, { headers: { cookie: admin.cookie } })).text();
    assert.match(seite, /data-ordnen="ranglisten"/);
    assert.match(seite, /class="ordnen-griff"/);
    assert.doesNotMatch(seite, />Höher<|>Tiefer<|>Hoch<|>Runter</, 'keine Knöpfe Hoch/Runter mehr');

    assert.equal((await sende(aufgebot.cookie, '/admin/raenge', [['_csrf', aufgebot.csrf], ['aktion', 'ordnen'], ['reihenfolge', String(kpl)]])).status, 403);

    // Kpl nach oben ziehen: neue Reihenfolge Kpl, Lt, Wm.
    const r = await sende(admin.cookie, '/admin/raenge', [['_csrf', admin.csrf], ['aktion', 'ordnen'], ['reihenfolge', String(kpl)], ['reihenfolge', String(lt)], ['reihenfolge', String(wm)]]);
    assert.equal(r.status, 303);
    assert.deepEqual((await zeilen(t.db, 'SELECT name FROM rang ORDER BY reihenfolge DESC')).map((x) => x.name), ['Kpl', 'Lt', 'Wm']);

    // Veraltete Liste (ein Rang fehlt): nichts ändert sich.
    await sende(admin.cookie, '/admin/raenge', [['_csrf', admin.csrf], ['aktion', 'ordnen'], ['reihenfolge', String(wm)], ['reihenfolge', String(kpl)]]);
    assert.deepEqual((await zeilen(t.db, 'SELECT name FROM rang ORDER BY reihenfolge DESC')).map((x) => x.name), ['Kpl', 'Lt', 'Wm']);

    // Menü ⋮ (ein Platz) geht weiter.
    await sende(admin.cookie, '/admin/raenge', [['_csrf', admin.csrf], ['aktion', 'tiefer'], ['id', String(kpl)]]);
    assert.deepEqual((await zeilen(t.db, 'SELECT name FROM rang ORDER BY reihenfolge DESC')).map((x) => x.name), ['Lt', 'Kpl', 'Wm']);

    // Rollen: Funk ganz nach oben.
    const neu = ['Funk', ...rollenVorher.filter((x) => x !== 'Funk')];
    await sende(admin.cookie, '/admin/rollen', [['_csrf', admin.csrf], ['aktion', 'ordnen'], ...neu.map((n) => ['reihenfolge', n] as [string, string])]);
    assert.deepEqual((await zeilen(t.db, 'SELECT name FROM rolle ORDER BY reihenfolge, name')).map((x) => x.name), neu);
    // Doppelter Name: nichts ändert sich.
    await sende(admin.cookie, '/admin/rollen', [['_csrf', admin.csrf], ['aktion', 'ordnen'], ...[...neu.slice(1), neu[1]].map((n) => ['reihenfolge', n] as [string, string])]);
    assert.deepEqual((await zeilen(t.db, 'SELECT name FROM rolle ORDER BY reihenfolge, name')).map((x) => x.name), neu);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
