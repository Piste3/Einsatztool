// T28: Live-Aktualisierung. Der Server meldet jede gespeicherte Änderung sofort an alle offenen Seiten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereAnmeldung, setzeAnmeldung } from '../src/domain/anmeldung.js';
import { schreibe } from '../src/db/db.js';
import { aenderungsStand } from '../src/db/aenderungen.js';
import { anzahlLiveVerbindungen, beendeLive } from '../src/web/routes-live.js';

/** Liest Ereignisse aus einem Event-Stream, bis pruefe() true liefert. */
async function warteAufEreignis(
  leser: ReadableStreamDefaultReader<Uint8Array>,
  pruefe: (ereignis: string, daten: any) => boolean,
  ms = 3000,
): Promise<{ ereignis: string; daten: any }> {
  const dekoder = new TextDecoder();
  let puffer = '';
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const { value, done } = await Promise.race([
      leser.read(),
      new Promise<{ value: undefined; done: true }>((ok) => setTimeout(() => ok({ value: undefined, done: true }), ende - Date.now())),
    ]);
    if (done) break;
    puffer += dekoder.decode(value, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const block = puffer.slice(0, i);
      puffer = puffer.slice(i + 2);
      const ereignis = /^event: (.*)$/m.exec(block)?.[1];
      const daten = /^data: (.*)$/m.exec(block)?.[1];
      if (ereignis && daten && pruefe(ereignis, JSON.parse(daten))) return { ereignis, daten: JSON.parse(daten) };
    }
  }
  throw new Error('Kein passendes Ereignis erhalten.');
}

test('T28 Jede gespeicherte Änderung geht sofort an alle offenen Seiten', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 1);
    const s = await einsatz(t.db, 'Live', inTagen(3, 8), inTagen(3, 12));
    const aid = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const { cookie } = await anmelden(t.db);

    // Ohne Anmeldung keine Live-Meldungen.
    assert.equal((await fetch(`${app.url}/live`)).status, 401);
    assert.equal((await fetch(`${app.url}/live/stand`)).status, 401);

    // Die Seite trägt den Stand, mit dem sie erzeugt wurde.
    const seite = await (await fetch(`${app.url}/schichten/${s.schichtId}`, { headers: { cookie } })).text();
    assert.match(seite, new RegExp(`data-live-nr="${aenderungsStand()}"`));
    assert.match(seite, /data-live/);

    // Zwei Benutzer öffnen die Live-Verbindung.
    const ab = new AbortController();
    const r1 = await fetch(`${app.url}/live`, { headers: { cookie }, signal: ab.signal });
    const r2 = await fetch(`${app.url}/live`, { headers: { cookie }, signal: ab.signal });
    assert.equal(r1.status, 200);
    assert.match(r1.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.equal(r1.headers.get('x-accel-buffering'), 'no');
    assert.match(r1.headers.get('cache-control') ?? '', /no-cache/);
    const l1 = r1.body!.getReader();
    const l2 = r2.body!.getReader();
    const start = await warteAufEreignis(l1, (e) => e === 'stand');
    await warteAufEreignis(l2, (e) => e === 'stand');
    assert.equal(start.daten.nr, aenderungsStand());

    // Eine Änderung: Beide erhalten sofort eine Meldung mit neuem Stand.
    const vorher = aenderungsStand();
    await aendereAnmeldung(t.db, aid, { status: 'bestaetigt' }, null);
    const e1 = await warteAufEreignis(l1, (e) => e === 'aenderung');
    const e2 = await warteAufEreignis(l2, (e) => e === 'aenderung');
    assert.ok(e1.daten.nr > vorher);
    assert.equal(e1.daten.nr, e2.daten.nr);

    // Ersatz ohne Event-Stream: derselbe Stand als JSON.
    const j = await (await fetch(`${app.url}/live/stand`, { headers: { cookie } })).json();
    assert.equal(j.nr, aenderungsStand());

    assert.ok(anzahlLiveVerbindungen() >= 2);
    ab.abort();
    await l1.cancel().catch(() => undefined);
    await l2.cancel().catch(() => undefined);
  } finally {
    beendeLive();
    await app.stopp();
    await t.ende();
  }
});

test('T28 Live-Abfragen verlängern die Sitzung nicht und holen keine Meldung ab', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Sitzung', inTagen(3, 8), inTagen(3, 12));
    const { cookie } = await anmelden(t.db);
    await schreibe(t.db, "UPDATE sitzung SET ablauf = '2999-01-01T00:00:00Z'");

    await (await fetch(`${app.url}/live/stand`, { headers: { cookie } })).json();
    // Hintergrund-Abfrage einer Seite (Live-Aktualisierung)
    const hg = await fetch(`${app.url}/schichten/${s.schichtId}`, { headers: { cookie: `${cookie}; meldung=abc.def`, 'x-live-abfrage': '1' } });
    assert.equal(hg.status, 200);
    // Die Meldung bleibt für die nächste echte Seite liegen.
    assert.doesNotMatch(hg.headers.get('set-cookie') ?? '', /meldung=;/);
    const [sitzung] = await zeilen(t.db, 'SELECT ablauf FROM sitzung');
    assert.equal(sitzung.ablauf, '2999-01-01T00:00:00Z');

    // Eine echte Seite verlängert die Sitzung.
    await fetch(`${app.url}/schichten/${s.schichtId}`, { headers: { cookie } });
    const [danach] = await zeilen(t.db, 'SELECT ablauf FROM sitzung');
    assert.notEqual(danach.ablauf, '2999-01-01T00:00:00Z');
  } finally {
    await app.stopp();
    await t.ende();
  }
});

test('T28 Admin › Update lädt ohne Live-Aktualisierung (Header «Refresh»)', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const { cookie } = await anmelden(t.db);
    const seite = await (await fetch(`${app.url}/admin/update`, { headers: { cookie } })).text();
    assert.match(seite, /data-ohne-live/);
    // Abmelden lädt die Seite normal.
    assert.match(seite, /action="\/logout" data-normal/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});
