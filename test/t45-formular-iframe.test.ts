// T45: Einbettung des Anmeldeformulars in Clubdesk (iframe). Nur das Formular und die Dankesseite, nur von FORM_ALLOWED_ORIGIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank } from './hilfe.js';
import { starteApp } from './web-hilfe.js';
import { herkunft } from '../src/config.js';

test('T45 Formular im iframe: nur die erlaubte Herkunft, der Rest des Tools bleibt gesperrt', async () => {
  assert.equal(herkunft('https://web.kkb.ch/termine/einsaetze/test'), 'https://web.kkb.ch');
  assert.equal(herkunft('kein url'), '');
  assert.equal(herkunft('javascript:alert(1)'), '');

  const t = await neueDatenbank();
  const app = await starteApp(t.db, { FORM_ALLOWED_ORIGIN: 'https://web.kkb.ch/termine/einsaetze/test' });
  try {
    for (const pfad of ['/anmeldung', '/anmeldung/danke']) {
      const r = await fetch(`${app.url}${pfad}`);
      assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors https:\/\/web\.kkb\.ch(;|$)/, pfad);
      assert.equal(r.headers.get('x-frame-options'), null, pfad);
    }
    const login = await fetch(`${app.url}/login`, { redirect: 'manual' });
    assert.match(login.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(login.headers.get('x-frame-options'), 'DENY');
  } finally {
    await app.stopp();
    await t.ende();
  }
  // Ohne Einstellung ist auch das Formular nicht einbettbar.
  const t2 = await neueDatenbank();
  const app2 = await starteApp(t2.db);
  try {
    const r = await fetch(`${app2.url}/anmeldung`);
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  } finally {
    await app2.stopp();
    await t2.ende();
  }
});
