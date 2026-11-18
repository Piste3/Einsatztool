// T08: Status wechselt nach bestaetigt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { setzeAnmeldung, aendereAnmeldung } from '../src/domain/anmeldung.js';
import { bestaetigungslauf } from '../src/domain/bestaetigung.js';

test('T08 Keine sofortige Mail, der Tageslauf legt eine Mail je Person an, ein zweiter Lauf nichts', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', email: 'anna@web.kkb.ch' });
    await person(t.db, 2, { vorname: 'Ben', email: 'ben@web.kkb.ch' });
    const a = await einsatz(t.db, 'Einsatz A', inTagen(3, 8), inTagen(3, 12), 'Basel');
    const b = await einsatz(t.db, 'Einsatz B', inTagen(5, 8), inTagen(5, 12), 'Riehen');
    const x1 = await setzeAnmeldung(t.db, { schichtId: a.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: b.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: a.schichtId, personId: 2, status: 'bestaetigt', kanal: 'telefon', rolle: 'Busfahrer' }, null);
    await aendereAnmeldung(t.db, x1, { status: 'bestaetigt' }, null);
    assert.equal((await zeilen(t.db, 'SELECT * FROM mail_queue')).length, 0);

    const r = await bestaetigungslauf(t.db, 'aufgebot@kkb.ch');
    assert.equal(r.mails, 2);
    const mails = await zeilen(t.db, 'SELECT * FROM mail_queue ORDER BY an');
    assert.equal(mails.length, 2);
    assert.equal(mails[0].an, 'anna@web.kkb.ch');
    assert.equal(mails[0].reply_to, 'aufgebot@kkb.ch');
    assert.match(mails[0].text, /Einsatz: Einsatz A/);
    assert.match(mails[0].text, /Einsatz: Einsatz B/);
    assert.doesNotMatch(mails[0].text, /https?:/);
    assert.match(mails[1].text, /Rolle: Busfahrer/);

    const r2 = await bestaetigungslauf(t.db, 'aufgebot@kkb.ch');
    assert.equal(r2.mails, 0);
    assert.equal((await zeilen(t.db, 'SELECT * FROM mail_queue')).length, 2);

    // Spätere Änderung ohne erneuten Wechsel nach «bestätigt»: keine neue Mail.
    await aendereAnmeldung(t.db, x1, { bemerkung: 'Kommt später' }, null);
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch')).mails, 0);
    // Erneuter Wechsel nach «bestätigt»: neue Mail.
    await aendereAnmeldung(t.db, x1, { status: 'unsicher' }, null);
    await aendereAnmeldung(t.db, x1, { status: 'bestaetigt' }, null);
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch')).mails, 1);
  } finally {
    await t.ende();
  }
});
