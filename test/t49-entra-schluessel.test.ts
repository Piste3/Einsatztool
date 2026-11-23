// T49: Ablauf des Entra-Schlüssels (Wunsch Yann 23.11.2026).
// Ablaufdatum in Admin › Einstellungen › Login, Warnung ab 30 Tagen im Cockpit, Anleitung mit Formular und «Heute + 2 Jahre».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leseEnvDatei } from '../src/config.js';
import { entraAblauf, inZweiJahren } from '../src/domain/entra-schluessel.js';
import { erstelleQuelle, zeilen as konfigZeilen } from '../src/domain/konfiguration.js';
import { lokalesDatum, plusTage } from '../src/domain/zeit.js';
import { neueDatenbank } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';

test('T49a Stufen der Warnung und Heute + 2 Jahre', () => {
  const mit = (d: string) => ({ ENTRA_TENANT_ID: 't', ENTRA_SECRET_ABLAUF: d });
  assert.equal(entraAblauf({ ENTRA_SECRET_ABLAUF: '2026-12-01' }, '2026-11-23').stufe, 'ohne_login');
  assert.equal(entraAblauf({ ENTRA_TENANT_ID: 't' }, '2026-11-23').stufe, 'fehlt');
  assert.deepEqual(entraAblauf(mit('2026-12-24'), '2026-11-23'), { stufe: 'ok', datum: '2026-12-24', tage: 31 });
  assert.deepEqual(entraAblauf(mit('2026-12-23'), '2026-11-23'), { stufe: 'bald', datum: '2026-12-23', tage: 30 });
  assert.equal(entraAblauf(mit('2026-11-23'), '2026-11-23').stufe, 'bald');
  assert.equal(entraAblauf(mit('2026-11-22'), '2026-11-23').stufe, 'abgelaufen');
  assert.equal(inZweiJahren('2026-11-23'), '2028-11-23');
  assert.equal(inZweiJahren('2028-02-29'), '2030-02-28');
});

test('T49b Cockpit warnt Admins, Anleitung speichert neuen Schlüssel, Datum wirkt ohne Neustart', async () => {
  const t = await neueDatenbank();
  const ordner = mkdtempSync(join(tmpdir(), 'ep-entra-'));
  const pfad = join(ordner, 'einsatzplaner.env');
  const bald = plusTage(lokalesDatum(new Date()), 10);
  writeFileSync(pfad, `ENTRA_TENANT_ID=mandant-test\nENTRA_CLIENT_ID=11111111-2222-3333-4444-555555555555\nENTRA_CLIENT_SECRET=ALT-GEHEIM-123\nENTRA_SECRET_ABLAUF=${bald}\n`);
  const konfigQuelle = erstelleQuelle(pfad, leseEnvDatei(readFileSync(pfad, 'utf8')), new Set());
  const neustarts: number[] = [];
  const app = await starteApp(t.db, {}, { konfigQuelle, neustart: () => neustarts.push(1) });
  try {
    const admin = await anmelden(t.db, 'admin');
    const aufgebot = await anmelden(t.db, 'aufgebot');
    const hole = async (cookie: string, pfadUrl: string) => fetch(`${app.url}${pfadUrl}`, { headers: { cookie }, redirect: 'manual' });
    const sende = (felder: Record<string, string>) => fetch(`${app.url}/admin/konfiguration`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: admin.csrf, ...felder }),
    });

    // Cockpit: Admin sieht die Warnung mit Knopf, Aufgebot nicht.
    const cockpit = await (await hole(admin.cookie, '/')).text();
    assert.match(cockpit, /läuft in 10 Tagen ab/);
    assert.match(cockpit, /href="\/admin\/einstellungen\/login\/entra-schluessel"/);
    assert.doesNotMatch(await (await hole(aufgebot.cookie, '/')).text(), /Entra-Schlüssel/);

    // Anleitung: nur Admin, Link zur App, Knopf «Heute + 2 Jahre», kein Geheimnis im HTML.
    assert.equal((await hole(aufgebot.cookie, '/admin/einstellungen/login/entra-schluessel')).status, 403);
    const anleitung = await (await hole(admin.cookie, '/admin/einstellungen/login/entra-schluessel')).text();
    assert.match(anleitung, /Credentials\/appId\/11111111-2222-3333-4444-555555555555/);
    assert.match(anleitung, new RegExp(`data-datum-setzen="${inZweiJahren()}"`));
    assert.doesNotMatch(anleitung, /ALT-GEHEIM-123/);
    // Reiter «Login» zeigt das Datumsfeld mit demselben Knopf.
    const login = await (await hole(admin.cookie, '/admin/einstellungen/login')).text();
    assert.match(login, /name="w_ENTRA_SECRET_ABLAUF" type="date"/);
    assert.match(login, /data-datum-setzen=/);

    // Nur das Datum ändern: wirkt sofort, kein Hinweis «Neustart», Warnung weg.
    const version = /name="version" value="([^"]+)"/.exec(anleitung)![1];
    const nurDatum = await sende({ version, reiter: 'login', w_ENTRA_SECRET_ABLAUF: inZweiJahren() });
    assert.equal(nurDatum.status, 303);
    assert.equal(konfigZeilen(konfigQuelle).zeilen.find((z) => z.d.schluessel === 'ENTRA_SECRET_ABLAUF')!.neustartNoetig, false);
    assert.doesNotMatch(await (await hole(admin.cookie, '/')).text(), /Entra-Schlüssel/);
    assert.doesNotMatch(await (await hole(admin.cookie, '/admin/einstellungen/login')).text(), /Einige Werte sind gespeichert, aber noch nicht aktiv/);

    // Ungültiges Datum: nichts gespeichert.
    const v2 = /name="version" value="([^"]+)"/.exec(await (await hole(admin.cookie, '/admin/einstellungen/login')).text())![1];
    assert.equal((await sende({ version: v2, reiter: 'login', w_ENTRA_SECRET_ABLAUF: '2027-02-30' })).status, 400);

    // Neuer Schlüssel über die Anleitung mit Neustart: Datei hat den neuen Wert, Protokoll ohne Klartext, Server startet neu.
    const neu = await sende({ version: v2, reiter: 'login', w_ENTRA_CLIENT_SECRET: 'NEU-GEHEIM-456', w_ENTRA_SECRET_ABLAUF: '01.12.2028', neustart: '1' });
    assert.equal(neu.status, 200);
    assert.match(await neu.text(), /Der Server startet neu/);
    const datei = readFileSync(pfad, 'utf8');
    assert.match(datei, /ENTRA_CLIENT_SECRET=NEU-GEHEIM-456/);
    assert.match(datei, /ENTRA_SECRET_ABLAUF=2028-12-01/);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(neustarts.length, 1);
    const [protokoll] = await t.db.query('SELECT alt, neu FROM konfiguration_protokoll WHERE schluessel = ?', ['ENTRA_CLIENT_SECRET']);
    assert.deepEqual((protokoll as { alt: string; neu: string }[]).map((p) => [p.alt, p.neu]), [['(gesetzt)', '(gesetzt)']]);
  } finally {
    const { setzeWartung } = await import('../src/web/wartung.js');
    setzeWartung(null);
    await app.stopp();
    await t.ende();
  }
});
