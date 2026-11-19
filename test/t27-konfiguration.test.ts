// T27: Admin › Konfiguration liest und schreibt einsatzplaner.env (Entscheid Yann 19.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leseEnvDatei } from '../src/config.js';
import { erstelleQuelle, formatiereWert, setzeInEnvText } from '../src/domain/konfiguration.js';
import { neueDatenbank, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';

test('T27a Schreiben behält Kommentare und Zeilenenden, Werte lesen sich gleich zurück', () => {
  const alt = '# Kommentar\r\nPORT=3010\r\n# SMTP_HOST=alt\r\nSMTP_HOST=\r\n';
  const neu = setzeInEnvText(alt, { PORT: '3020', SMTP_HOST: 'smtp.office365.com', MAIL_ROMAN: 'roman@kkb.ch' });
  assert.match(neu, /^# Kommentar\r\nPORT=3020\r\n# SMTP_HOST=alt\r\nSMTP_HOST=smtp\.office365\.com\r\n/);
  assert.ok(neu.endsWith('MAIL_ROMAN=roman@kkb.ch\r\n'));
  assert.ok(!/[^\r]\n/.test(neu), 'nur CRLF');
  for (const w of ['"a"', ' x ', "a'", '"b', 'C:\\einsatzplaner\\data', 'a=b#c']) {
    assert.equal(leseEnvDatei(`K=${formatiereWert(w)}`).K, w, w);
  }
});

test('T27b Admin ändert Werte, Geheimnisse bleiben verborgen, Protokoll, Konflikt, Umgebungsvariable', async () => {
  const t = await neueDatenbank();
  const ordner = mkdtempSync(join(tmpdir(), 'ep-konfig-'));
  const pfad = join(ordner, 'einsatzplaner.env');
  writeFileSync(pfad, '# Test\nPORT=3010\nSMTP_HOST=smtp.alt.ch\nSMTP_PASS=GEHEIM-ALT-123\nDB_NAME=einsatzplaner\n');
  const env = { ...leseEnvDatei(readFileSync(pfad, 'utf8')), MAIL_FROM: 'fest@kkb.ch' };
  const konfigQuelle = erstelleQuelle(pfad, env, new Set(['MAIL_FROM', 'PATH']));
  const app = await starteApp(t.db, {}, { konfigQuelle });
  try {
    const admin = await anmelden(t.db, 'admin');
    const aufgebot = await anmelden(t.db, 'aufgebot');
    const hole = async (cookie: string) => fetch(`${app.url}/admin/konfiguration`, { headers: { cookie }, redirect: 'manual' });
    const sende = (cookie: string, felder: Record<string, string>) => fetch(`${app.url}/admin/konfiguration`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(felder),
    });

    assert.equal((await hole(aufgebot.cookie)).status, 403);
    assert.equal((await sende(aufgebot.cookie, { _csrf: aufgebot.csrf, w_PORT: '1' })).status, 403);

    const seite = await (await hole(admin.cookie)).text();
    assert.match(seite, /smtp\.alt\.ch/);
    assert.doesNotMatch(seite, /GEHEIM-ALT-123/, 'Geheimnis nie an den Browser');
    assert.match(seite, /fest@kkb\.ch/);
    const version = /name="version" value="([^"]+)"/.exec(seite)![1];

    // Ohne CSRF-Token speichert das Tool nichts.
    assert.equal((await sende(admin.cookie, { w_PORT: '3999' })).status, 403);

    // Ungültiger Port: nichts gespeichert, Eingaben bleiben stehen.
    const falsch = await sende(admin.cookie, { _csrf: admin.csrf, version, w_PORT: '99999', w_SMTP_HOST: 'smtp.neu.ch' });
    assert.equal(falsch.status, 400);
    assert.match(await falsch.text(), /smtp\.neu\.ch/);
    assert.match(readFileSync(pfad, 'utf8'), /PORT=3010/);

    // Speichern: Port und SMTP-Passwort neu, leeres Geheimnis bleibt, Umgebungsvariable ist gesperrt.
    const ok = await sende(admin.cookie, {
      _csrf: admin.csrf, version, w_PORT: '3020', w_SMTP_HOST: 'smtp.alt.ch', w_SMTP_PASS: 'GEHEIM-NEU-456', w_DB_PASSWORD: '', w_MAIL_FROM: 'boese@x.ch',
    });
    assert.equal(ok.status, 303);
    const datei = readFileSync(pfad, 'utf8');
    assert.match(datei, /^# Test\nPORT=3020\n/);
    assert.match(datei, /SMTP_PASS=GEHEIM-NEU-456/);
    assert.doesNotMatch(datei, /MAIL_FROM|DB_PASSWORD/);
    assert.ok(existsSync(`${pfad}.vorher`));

    const p = await zeilen(t.db, 'SELECT * FROM konfiguration_protokoll ORDER BY id');
    assert.deepEqual(p.map((x) => x.schluessel), ['PORT', 'SMTP_PASS']);
    assert.equal(p[0].benutzer_id, admin.benutzerId);
    assert.equal(p[0].alt, '3010');
    assert.equal(p[0].neu, '3020');
    assert.equal(p[1].alt, '(gesetzt)');
    assert.equal(p[1].neu, '(gesetzt)');
    const nachher = await (await hole(admin.cookie)).text();
    assert.doesNotMatch(nachher, /GEHEIM-NEU-456/);
    assert.match(nachher, /wirkt nach Neustart/);

    // Konflikt: Formular mit altem Stand speichert nichts.
    const konflikt = await sende(admin.cookie, { _csrf: admin.csrf, version, w_PORT: '3030' });
    assert.equal(konflikt.status, 409);
    assert.match(readFileSync(pfad, 'utf8'), /PORT=3020/);

    // Datenbank nicht erreichbar: nur mit Häkchen «Trotzdem speichern».
    const v2 = /name="version" value="([^"]+)"/.exec(nachher)![1];
    const db1 = await sende(admin.cookie, { _csrf: admin.csrf, version: v2, w_DB_NAME: 'gibt_es_nicht_xyz', w_DB_HOST: '127.0.0.1', w_DB_PORT: '1' });
    assert.equal(db1.status, 400);
    assert.match(await db1.text(), /Trotzdem speichern/);
    assert.match(readFileSync(pfad, 'utf8'), /DB_NAME=einsatzplaner/);
    const db2 = await sende(admin.cookie, { _csrf: admin.csrf, version: v2, w_DB_NAME: 'gibt_es_nicht_xyz', w_DB_HOST: '127.0.0.1', w_DB_PORT: '1', trotzdem: '1' });
    assert.equal(db2.status, 303);
    assert.match(readFileSync(pfad, 'utf8'), /DB_NAME=gibt_es_nicht_xyz/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
