// T19: Aufruf ohne Login, und POST mit falschem CSRF-Token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';

test('T19 ohne Login: Umleitung zu Microsoft Entra; falsches CSRF-Token: 403', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const r1 = await fetch(`${app.url}/`, { redirect: 'manual' });
    assert.equal(r1.status, 302);
    assert.match(r1.headers.get('location') ?? '', /^\/login/);

    const r2 = await fetch(`${app.url}/login`, { redirect: 'manual' });
    assert.equal(r2.status, 302);
    const ziel = new URL(r2.headers.get('location') ?? '');
    assert.equal(ziel.hostname, 'login.microsoftonline.com');
    assert.equal(ziel.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(ziel.searchParams.get('state'));

    // Sicherheits-Header
    assert.match(r1.headers.get('content-security-policy') ?? '', /default-src 'self'/);

    const { cookie, csrf } = await anmelden(t.db);
    const falsch = await fetch(`${app.url}/einsaetze`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: 'falsch', name: 'X' }),
    });
    assert.equal(falsch.status, 403);
    const ohne = await fetch(`${app.url}/einsaetze`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'X' }),
    });
    assert.equal(ohne.status, 403);

    // Mit gültigem Token kommt die Anfrage durch (Fehler in der Eingabe führt zurück, kein 403).
    const gut = await fetch(`${app.url}/einsaetze`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, name: '' }),
    });
    assert.notEqual(gut.status, 403);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
