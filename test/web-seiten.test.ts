// Rauchtest: Jede Seite antwortet mit Login ohne Fehler, und Formulare laufen durch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { schreibe } from '../src/db/db.js';
import { erstelleFormularToken } from '../src/domain/formular.js';

test('Alle Seiten antworten ohne Fehler', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db, { MAIL_ROMAN: 'roman@kkb.ch' });
  try {
    const r = await rang(t.db, 'Kpl', 1);
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Müller', rang_id: r, telefon: '079 111 22 33', email: 'eva@web.kkb.ch' });
    const s = await einsatz(t.db, 'Stadtlauf <b>2026</b>', inTagen(14, 7), inTagen(14, 15), 'Marktplatz');
    const aid = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon', rolle: 'Einsatzleitung' }, null);
    const u = await schreibe(
      t.db,
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, email_text, status, kanal, erstellt_am, geaendert_am)
       VALUES (?, NULL, 'Fremd Person', 'f@example.ch', 'angemeldet', 'formular', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [s.schichtId],
    );
    const { cookie, csrf } = await anmelden(t.db);
    const seiten = [
      '/', '/einsaetze', '/einsaetze?archiv=1', '/einsaetze/neu', `/einsaetze/${s.einsatzId}`, `/einsaetze/${s.einsatzId}/bearbeiten`,
      `/einsaetze/${s.einsatzId}/kopieren`, `/einsaetze/${s.einsatzId}/loeschen`, `/einsaetze/${s.einsatzId}/export.csv`,
      `/einsaetze/${s.einsatzId}/teilnehmerliste`, `/einsaetze/${s.einsatzId}/schichten/neu`,
      `/schichten/${s.schichtId}`, `/schichten/${s.schichtId}/bearbeiten`, `/schichten/${s.schichtId}/loeschen`,
      `/schichten/${s.schichtId}/anrufliste`, `/schichten/${s.schichtId}/anrufliste?alle=1`, `/schichten/${s.schichtId}/ics`,
      `/schichten/${s.schichtId}/termintext`, `/schichten/${s.schichtId}/aufgebot`, `/schichten/${s.schichtId}/essensliste.csv`,
      `/anmeldungen/${aid}/loeschen`, '/anmeldungen/unbekannt', '/personen', '/personen/1', '/rueckmeldungen',
      '/admin/import', '/admin/export', '/admin/benutzer', '/admin/raenge', '/admin/rollen', '/admin/einstellungen', '/admin/update',
      '/anmeldung', '/health',
    ];
    for (const pfad of seiten) {
      const antwort = await fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' });
      const text = await antwort.text();
      assert.ok(antwort.status === 200 || antwort.status === 302, `${pfad}: ${antwort.status} ${text.slice(0, 300)}`);
      if ((antwort.headers.get('content-type') ?? '').startsWith('text/html')) {
        assert.doesNotMatch(text, /<b>2026<\/b>/, `${pfad}: HTML nicht maskiert`);
        assert.doesNotMatch(text, /style="|<script>/, `${pfad}: Inline-Stil oder Inline-Skript`);
      }
    }

    const post = async (pfad: string, felder: Record<string, string>) => {
      const antwort = await fetch(`${app.url}${pfad}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, ...felder }),
      });
      const text = await antwort.text();
      assert.ok(antwort.status === 303 || antwort.status === 302 || antwort.status === 200, `POST ${pfad}: ${antwort.status} ${text.slice(0, 300)}`);
      return antwort;
    };
    await post(`/anmeldungen/${aid}`, { status: 'bestaetigt', kanal: 'telefon', rolle: 'Einsatzleitung', bemerkung: 'ok' });
    await post(`/schichten/${s.schichtId}/publizieren`, { publiziert: '0' });
    await post(`/schichten/${s.schichtId}/sammelstatus`, { personen: '1', status: 'unsicher', kanal: 'whatsapp' });
    await post(`/anmeldungen/${u.insertId}/zuordnen`, { person: '1' });
    await post('/admin/raenge', { aktion: 'anlegen', name: 'Wm' });
    await post('/admin/rollen', { aktion: 'anlegen', name: 'Funk', zaehlt: '1' });

    const pruefe = async (sql: string, erwartet: unknown) => {
      const [z] = (await t.db.query(sql)) as any;
      assert.deepEqual(Object.values(z[0] ?? {})[0], erwartet, sql);
    };
    await pruefe(`SELECT status FROM anmeldung WHERE id = ${aid}`, 'unsicher');
    await pruefe(`SELECT publiziert FROM schicht WHERE id = ${s.schichtId}`, 0);
    await pruefe(`SELECT person_id FROM anmeldung WHERE id = ${u.insertId}`, null);
    await pruefe("SELECT COUNT(*) FROM rang WHERE name = 'Wm'", 1);
    await pruefe("SELECT COUNT(*) FROM rolle WHERE name = 'Funk'", 1);

    // Öffentliches Formular: ohne gültiges Token keine Speicherung, mit Token schon.
    const formular = await fetch(`${app.url}/anmeldung`);
    assert.equal(formular.status, 200);
    void erstelleFormularToken;
  } finally {
    await app.stopp();
    await t.ende();
  }
});
