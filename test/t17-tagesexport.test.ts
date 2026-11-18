// T17: Tagesexport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neueDatenbank, einsatz, inTagen, person } from './hilfe.js';
import { tagesexport } from '../src/domain/export.js';
import { SharePoint } from '../src/domain/sharepoint.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { lokalesDatum, plusTage } from '../src/domain/zeit.js';

test('T17 Zwei CSV in aktuell/, Datenbankkopie mit Datum, alte Kopien gelöscht, Upload mit Attrappe', async () => {
  const t = await neueDatenbank();
  const ordner = mkdtempSync(join(tmpdir(), 'ep-export-'));
  try {
    await person(t.db, 1, { vorname: 'Anna', nachname: 'Muster', telefon: '+41 79 123 45 67' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(3, 8), inTagen(3, 12));
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);

    mkdirSync(join(ordner, 'aktuell'), { recursive: true });
    mkdirSync(join(ordner, 'backup'), { recursive: true });
    writeFileSync(join(ordner, 'aktuell', 'uebersicht.csv'), 'alt');
    const heute = lokalesDatum(new Date());
    const alt = `datenbank-${plusTage(heute, -15)}.sql`;
    const jung = `datenbank-${plusTage(heute, -14)}.sql`;
    writeFileSync(join(ordner, 'backup', alt), 'x');
    writeFileSync(join(ordner, 'backup', jung), 'x');

    // Attrappe für Microsoft Graph
    const aufrufe: { methode: string; url: string }[] = [];
    const sharepointDateien = [{ id: 'alt1', name: alt }, { id: 'jung1', name: jung }];
    const attrappe = async (url: string, init?: RequestInit): Promise<Response> => {
      const methode = init?.method ?? 'GET';
      aufrufe.push({ methode, url });
      if (url.includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      if (url.includes('/children')) return Response.json({ value: sharepointDateien });
      return new Response('{}', { status: 200 });
    };
    const sp = new SharePoint({ tenantId: 't', clientId: 'c', clientSecret: 's', siteId: 'site', driveId: 'drive', ordner: 'Einsatzplaner' }, attrappe);

    const r = await tagesexport(t.db, ordner, sp);
    assert.equal(r.ok, true, r.meldungen.join('\n'));
    const uebersicht = readFileSync(join(ordner, 'aktuell', 'uebersicht.csv'));
    assert.deepEqual([...uebersicht.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = uebersicht.toString('utf8');
    assert.match(text, /^﻿Einsatz;Schicht;Datum;Start;Ende;Ort;Name;Status;Rolle;Kanal;Telefon;E-Mail;Essenseinschränkung;Bemerkung/);
    assert.match(text, /Herbstmesse;Herbstmesse;\d{2}\.\d{2}\.\d{4};\d{2}:\d{2};/);
    assert.match(text, /\+41 79 123 45 67/);
    assert.ok(existsSync(join(ordner, 'aktuell', 'personen.csv')));
    assert.ok(existsSync(join(ordner, 'backup', `datenbank-${heute}.sql`)));
    assert.ok(readFileSync(join(ordner, 'backup', `datenbank-${heute}.sql`), 'utf8').includes('CREATE TABLE `anmeldung`'));
    assert.ok(!existsSync(join(ordner, 'backup', alt)));
    assert.ok(existsSync(join(ordner, 'backup', jung)));

    const puts = aufrufe.filter((a) => a.methode === 'PUT').map((a) => decodeURIComponent(a.url));
    assert.ok(puts.some((u) => u.includes('Einsatzplaner/aktuell/uebersicht.csv:/content')));
    assert.ok(puts.some((u) => u.includes('Einsatzplaner/aktuell/personen.csv:/content')));
    assert.ok(puts.some((u) => u.includes(`Einsatzplaner/backup/datenbank-${heute}.sql:/content`)));
    assert.ok(aufrufe.some((a) => a.methode === 'DELETE' && a.url.includes('/items/alt1')));
    assert.ok(!aufrufe.some((a) => a.methode === 'DELETE' && a.url.includes('/items/jung1')));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
    await t.ende();
  }
});
