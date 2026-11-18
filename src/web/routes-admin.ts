// Admin: Import (16), Export (19.1, 18.1.6), Benutzer, Einstellungen (Ränge 14.5, Rollen), Update.
import type { Express, Request, Response } from 'express';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Abhaengigkeiten } from './app.js';
import { nurAdmin, zurueck } from './app.js';
import { erstelleVorschau, letzteImporte, wendeImportAn, type Vorschau } from '../domain/import-clubdesk.js';
import { ladeImportdatei, loescheImportdatei, speichereImportdatei } from '../domain/importdatei.js';
import { bestaetigungenOhneAdresse, mailsMitFehler } from '../domain/bestaetigung.js';
import {
  benenneRangUm, benutzerListe, legeRangAn, legeRolleAn, loescheRang, loescheRolle, raenge, rollen, setzeBenutzerAktiv, setzeRolleZaehlt,
  verschiebeRang, verschiebeRolle,
} from '../domain/stammdaten.js';
import { Eingabefehler, id as leseId, liste } from '../domain/eingabe.js';
import { feedStand } from '../domain/ical-abgleich.js';
import { letzterLauf } from '../jobs/taeglich.js';
import { html, Roh } from './html.js';
import { k } from './kontext.js';
import { formFelder, seite } from './views/layout.js';
import { datumZeit, knopfPost, zeitraum } from './views/teile.js';
import type { HochgeladeneDatei } from './multipart.js';

function vorschauSeite(kx: ReturnType<typeof k>, v: Vorschau, datei: string, dateiname: string, meldung: string | null, auswahl: Set<number> | null): Roh {
  const keineFehler = v.fehler.length === 0;
  const geloescht = auswahl ?? new Set(v.entferntOhneZukunft.map((e) => e.clubdesk_id));
  return html`
<h1>Import-Vorschau</h1>
<p class="unter">Datei: ${dateiname}</p>
${meldung ? html`<div class="meldung fehler" role="alert">${meldung}</div>` : ''}
${v.fehler.length ? html`<div class="meldung fehler"><strong>Die Datei hat Fehler. Der Import ist abgebrochen.</strong><ul>${v.fehler.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
${v.vieleAustritte ? html`<div class="banner rot">Ungewöhnlich viele Austritte. Prüfe die CSV.</div>` : ''}
<div class="zahl-karten">
  <div class="zahl-karte"><span class="wert">${v.neu.length}</span><span class="titel">neu</span></div>
  <div class="zahl-karte"><span class="wert">${v.geaendert.length}</span><span class="titel">geändert</span></div>
  <div class="zahl-karte"><span class="wert">${v.unveraendert}</span><span class="titel">unverändert</span></div>
  <div class="zahl-karte ${v.entferntMitZukunft.length + v.entferntOhneZukunft.length ? 'orange' : ''}"><span class="wert">${v.entferntMitZukunft.length + v.entferntOhneZukunft.length}</span><span class="titel">entfernt</span></div>
  <div class="zahl-karte"><span class="wert">${v.ohneVereinsadresse}</span><span class="titel">ohne Vereinsadresse</span></div>
</div>
<form method="post" action="/admin/import/anwenden" class="stapel">
  ${formFelder(kx)}
  <input type="hidden" name="datei" value="${datei}">
  <input type="hidden" name="dateiname" value="${dateiname}">
  ${v.entferntMitZukunft.length ? html`<section class="abschnitt">
    <h2>Austritte mit künftigen Anmeldungen (${v.entferntMitZukunft.length})</h2>
    <p class="meldung hinweis" data-code="W_AUSTRITT">⚠ Person fehlt in der CSV. Zuerst abmelden. Das Tool löscht diese Personendaten nicht. Trage die Personen zuerst aus diesen Einsätzen aus.</p>
    <ul>${v.entferntMitZukunft.map((e) => html`<li><a href="/personen/${e.clubdesk_id}">${e.name}</a> (ID ${e.clubdesk_id}): ${e.einsaetze.join(', ')}</li>`)}</ul>
  </section>` : ''}
  ${v.entferntOhneZukunft.length ? html`<section class="abschnitt">
    <h2>Austritte ohne künftige Anmeldungen (${v.entferntOhneZukunft.length})</h2>
    <p>Gewählte Personen: Das Tool löscht die Personendaten. Die ID und die vergangenen Einsätze bleiben im Archiv.</p>
    <ul class="ohne-punkte">${v.entferntOhneZukunft.map((e) => html`<li><label class="haken"><input type="checkbox" name="loeschen" value="${e.clubdesk_id}"${geloescht.has(e.clubdesk_id) ? new Roh(' checked') : ''}> ${e.name} (ID ${e.clubdesk_id})</label></li>`)}</ul>
    <label class="haken wichtig"><input type="checkbox" name="loeschen_bestaetigt" value="1"> Personendaten der gewählten Personen löschen? Die ID bleibt.</label>
  </section>` : ''}
  ${v.unbekannteRaenge.length ? html`<section class="abschnitt"><h2>Unbekannte Ränge</h2>
    <p>Diese Ränge gibt es in den Einstellungen nicht. Der Rang bleibt leer. Lege die Ränge in den <a href="/admin/einstellungen">Einstellungen</a> an und importiere neu.</p>
    <ul>${v.unbekannteRaenge.map((r) => html`<li>${r}</li>`)}</ul></section>` : ''}
  ${v.hinweise.length ? html`<section class="abschnitt"><h2>Hinweise</h2><ul>${v.hinweise.map((h) => html`<li>${h}</li>`)}</ul></section>` : ''}
  ${v.neu.length ? html`<details class="gruppe"><summary><h2>Neu (${v.neu.length})</h2></summary><ul>${v.neu.map((p) => html`<li>${p.vorname} ${p.nachname} (ID ${p.clubdesk_id})</li>`)}</ul></details>` : ''}
  ${v.geaendert.length ? html`<details class="gruppe" open><summary><h2>Geändert (${v.geaendert.length})</h2></summary>
    <div class="rahmen"><table class="tabelle"><thead><tr><th>Person</th><th>Feld</th><th>Alt</th><th>Neu</th></tr></thead><tbody>
    ${v.geaendert.map((g) => g.aenderungen.length
      ? g.aenderungen.map((a, i) => html`<tr>${i === 0 ? html`<td rowspan="${g.aenderungen.length}">${g.name} (ID ${g.clubdesk_id})${g.wieder ? html` <span class="pille">wieder da</span>` : ''}</td>` : ''}<td>${a.feld}</td><td>${a.alt ?? '–'}</td><td>${a.neu ?? '–'}</td></tr>`)
      : html`<tr><td>${g.name} (ID ${g.clubdesk_id}) <span class="pille">wieder da</span></td><td colspan="3"></td></tr>`)}
    </tbody></table></div></details>` : ''}
  ${v.vieleAustritte ? html`<label class="haken wichtig"><input type="checkbox" name="austritte_bestaetigt" value="1"> Ich habe die CSV geprüft. Die vielen Austritte stimmen.</label>` : ''}
  <div class="knopfreihe">
    ${keineFehler ? html`<button type="submit" class="knopf haupt">Anwenden</button>` : ''}
    <a class="knopf" href="/admin/import">Abbrechen</a>
  </div>
</form>`;
}

export function registriereAdmin(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  // ---------- Import ----------
  app.get('/admin/import', nurAdmin, async (_req, res) => {
    const kx = k(res);
    const letzte = await letzteImporte(db);
    res.send(seite(kx, 'Import', 'import', html`
<h1>Clubdesk-Import</h1>
<p>Lade die komplette CSV aus Clubdesk hoch. Das Tool zeigt zuerst eine Vorschau. Es ändert erst nach «Anwenden» etwas.</p>
<form method="post" action="/admin/import" enctype="multipart/form-data" class="stapel">
  ${formFelder(kx)}
  <div class="feld"><label for="datei">CSV-Datei (höchstens 5 MB)</label><input id="datei" type="file" name="datei" accept=".csv,text/csv" required></div>
  <button type="submit" class="knopf haupt">Vorschau zeigen</button>
</form>
${letzte.length ? html`<h2>Letzte Importe</h2><div class="rahmen"><table class="tabelle"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Datei</th><th>Neu</th><th>Geändert</th><th>Gelöscht</th></tr></thead>
<tbody>${letzte.map((i) => html`<tr><td>${datumZeit(i.zeit)}</td><td>${i.benutzer ?? ''}</td><td>${i.dateiname ?? ''}</td><td>${i.neu}</td><td>${i.geaendert}</td><td>${i.entfernt}</td></tr>`)}</tbody></table></div>` : ''}`));
  });

  app.post('/admin/import', nurAdmin, async (req: Request, res: Response) => {
    const kx = k(res);
    const datei = ((req as Request & { dateien?: HochgeladeneDatei[] }).dateien ?? []).find((d) => d.feld === 'datei');
    if (!datei || !datei.inhalt.length) throw new Eingabefehler('Wähle eine CSV-Datei.');
    if (datei.inhalt.length > 5 * 1024 * 1024) throw new Eingabefehler('Die Datei ist grösser als 5 MB.');
    let v: Vorschau;
    try {
      v = await erstelleVorschau(db, datei.inhalt);
    } catch (e) {
      if (e instanceof Eingabefehler) {
        res.status(400).send(seite(kx, 'Import', 'import', html`<h1>Import abgebrochen</h1><div class="meldung fehler">${e.message}</div><p><a class="knopf" href="/admin/import">Zurück</a></p>`));
        return;
      }
      throw e;
    }
    const name = speichereImportdatei(konfig.dataDir, datei.inhalt);
    res.send(seite(kx, 'Import-Vorschau', 'import', vorschauSeite(kx, v, name, datei.dateiname.slice(0, 200), null, null)));
  });

  app.post('/admin/import/anwenden', nurAdmin, async (req, res) => {
    const kx = k(res);
    const name = String(req.body?.datei ?? '');
    const dateiname = String(req.body?.dateiname ?? '').slice(0, 200);
    const inhalt = ladeImportdatei(konfig.dataDir, name);
    const loeschen = liste(req.body?.loeschen).filter((x) => /^\d+$/.test(x)).map(Number);
    const r = await wendeImportAn(
      db,
      inhalt,
      {
        loeschen,
        loeschenBestaetigt: req.body?.loeschen_bestaetigt === '1',
        austritteBestaetigt: req.body?.austritte_bestaetigt === '1',
        dateiname,
      },
      kx.benutzer!.id,
    );
    if (!r.angewendet) {
      // Entscheid Yann: Ohne Bestätigung zeigt das Tool die Vorschau erneut und ändert nichts.
      res.status(400).send(seite(kx, 'Import-Vorschau', 'import', vorschauSeite(kx, r.vorschau, name, dateiname, r.grund, new Set(loeschen))));
      return;
    }
    loescheImportdatei(konfig.dataDir, name);
    const z = r.zusammenfassung;
    res.send(seite(kx, 'Import angewendet', 'import', html`
<h1>Import angewendet</h1>
<div class="zahl-karten">
  <div class="zahl-karte"><span class="wert">${z.neu}</span><span class="titel">neu</span></div>
  <div class="zahl-karte"><span class="wert">${z.geaendert}</span><span class="titel">geändert</span></div>
  <div class="zahl-karte"><span class="wert">${z.unveraendert}</span><span class="titel">unverändert</span></div>
  <div class="zahl-karte"><span class="wert">${z.geloescht}</span><span class="titel">Personendaten gelöscht</span></div>
  <div class="zahl-karte ${z.unzugeordnet ? 'orange' : ''}"><span class="wert">${z.unzugeordnet}</span><span class="titel">unzugeordnete Anmeldungen</span></div>
</div>
${z.unzugeordnet ? html`<p><a class="knopf" href="/anmeldungen/unbekannt">Unbekannte Anmeldungen zuordnen</a></p>` : ''}
<p><a href="/personen">Zu den Personen</a></p>`));
  });

  // ---------- Export ----------
  app.get('/admin/export', nurAdmin, async (_req, res) => {
    const kx = k(res);
    const lauf = await letzterLauf(db, 'tagesexport');
    const best = await letzterLauf(db, 'bestaetigungsmail');
    const fehler = await mailsMitFehler(db);
    const ohne = await bestaetigungenOhneAdresse(db);
    const backup = join(konfig.exportDir, 'backup');
    const kopien = existsSync(backup) ? readdirSync(backup).filter((n) => n.endsWith('.sql')).sort().reverse() : [];
    const feed = feedStand();
    res.send(seite(kx, 'Export', 'export', html`
<h1>Export und Mails</h1>
<section class="abschnitt">
  <h2>Tagesexport</h2>
  <p>Täglich um ${konfig.exportStunde}:00 Uhr. Ziel: ${konfig.exportDir}${konfig.sharepoint.siteId ? ` und SharePoint (${konfig.sharepoint.ordner})` : ' (SharePoint nicht eingerichtet)'}.</p>
  ${lauf ? html`<div class="meldung ${lauf.ok ? 'ok' : 'fehler'}"><strong>Letzter Lauf ${datumZeit(lauf.zeit)}:</strong><br>${(lauf.meldung ?? '').split('\n').map((z, i) => html`${i ? html`<br>` : ''}${z}`)}</div>` : html`<p class="unter">Noch kein Lauf.</p>`}
  ${knopfPost(kx, '/admin/export/jetzt', 'Export jetzt auslösen', {}, 'knopf haupt', '/admin/export')}
  ${kopien.length ? html`<details class="aufklapp"><summary>Lokale Datenbankkopien (${kopien.length})</summary><ul>${kopien.map((n) => html`<li>${n} (${Math.round(statSync(join(backup, n)).size / 1024)} KB)</li>`)}</ul></details>` : ''}
</section>
<section class="abschnitt">
  <h2>Bestätigungsmails</h2>
  <p>Täglich um ${konfig.bestaetigungStunde}:00 Uhr, gesammelt je Person.${konfig.smtp.host ? '' : ' SMTP ist nicht eingerichtet: Mails bleiben in der Warteschlange.'}</p>
  ${best ? html`<p class="unter">Letzter Lauf ${datumZeit(best.zeit)}: ${best.meldung ?? ''}</p>` : ''}
  ${knopfPost(kx, '/admin/export/bestaetigungen', 'Bestätigungen jetzt senden', {}, 'knopf', '/admin/export')}
  ${ohne.length ? html`<h3>Bestätigt ohne Mail-Adresse (${ohne.length})</h3><ul>${ohne.map((a) => html`<li><a href="/schichten/${a.schicht_id}">${a.einsatz} – ${a.schicht}</a> · ${zeitraum(a.start_zeit, a.start_zeit)} · ${a.name_text}</li>`)}</ul>` : ''}
  ${fehler.length ? html`<h3>Mails mit Fehler (${fehler.length})</h3><div class="rahmen"><table class="tabelle"><thead><tr><th>An</th><th>Betreff</th><th>Versuche</th><th>Fehler</th></tr></thead><tbody>
    ${fehler.map((m) => html`<tr><td>${m.an}</td><td>${m.betreff}</td><td>${m.versuche}</td><td class="fehler-text">${m.fehler ?? ''}</td></tr>`)}</tbody></table></div>` : ''}
</section>
<section class="abschnitt">
  <h2>Clubdesk-Kalender</h2>
  <p>${konfig.clubdeskIcalUrl ? (feed.geladenAm ? `Feed geladen ${datumZeit(feed.geladenAm)}, ${feed.termine?.length ?? 0} Termine.` : 'Feed noch nicht geladen.') : 'CLUBDESK_ICAL_URL fehlt in der Konfiguration.'}
  ${feed.fehlerSeit ? html`<br><span class="fehler-text">Abgleich nicht verfügbar seit ${datumZeit(feed.fehlerSeit)}: ${feed.fehler ?? ''}</span>` : ''}</p>
</section>`));
  });

  app.post('/admin/export/jetzt', nurAdmin, async (req, res) => {
    const r = await deps.tagesexportJetzt();
    zurueck(req, res, '/admin/export', r.ok ? 'Export erfolgreich.' : 'Export mit Fehlern. Details siehe unten.', r.ok ? 'ok' : 'fehler');
  });

  app.post('/admin/export/bestaetigungen', nurAdmin, async (req, res) => {
    const r = await deps.bestaetigungenJetzt();
    zurueck(req, res, '/admin/export', r.meldung, r.ok ? 'ok' : 'fehler');
  });

  // ---------- Benutzer ----------
  app.get('/admin/benutzer', nurAdmin, async (_req, res) => {
    const kx = k(res);
    const liste = await benutzerListe(db);
    res.send(seite(kx, 'Benutzer', 'benutzer', html`
<h1>Benutzer</h1>
<p class="unter">Benutzer entstehen beim ersten Login über Microsoft Entra. Die Rolle kommt aus Entra (Admin oder Aufgebot). Ein inaktiver Benutzer kommt nicht hinein.</p>
<div class="rahmen"><table class="tabelle"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Aktiv</th></tr></thead><tbody>
${liste.map((b) => html`<tr><td>${b.name}</td><td>${b.email}</td><td>${b.rolle === 'admin' ? 'Admin' : 'Aufgebot'}</td>
  <td>${b.id === kx.benutzer!.id ? 'ja (du)' : knopfPost(kx, '/admin/benutzer', b.aktiv ? 'aktiv' : 'inaktiv', { id: String(b.id), aktiv: b.aktiv ? '0' : '1' }, `schalter${b.aktiv ? ' an' : ''}`, '/admin/benutzer')}</td></tr>`)}
</tbody></table></div>`));
  });

  app.post('/admin/benutzer', nurAdmin, async (req, res) => {
    const id = leseId(req.body?.id);
    if (id === k(res).benutzer!.id) throw new Eingabefehler('Du kannst dich nicht selbst deaktivieren.');
    await setzeBenutzerAktiv(db, id, req.body?.aktiv === '1');
    zurueck(req, res, '/admin/benutzer');
  });

  // ---------- Einstellungen: Ränge und Rollen ----------
  const einstellungen = async (_req: Request, res: Response) => {
    const kx = k(res);
    const r = await raenge(db);
    const ro = await rollen(db);
    const z = '/admin/einstellungen';
    res.send(seite(kx, 'Einstellungen', 'einstellungen', html`
<h1>Einstellungen</h1>
<section class="abschnitt" id="raenge">
  <h2>Ränge</h2>
  <p class="unter">Der oberste Rang ist der höchste. Ein neuer Rang kommt ans Ende (tiefster Rang). Der Import ordnet den Rang über den Namen zu.</p>
  <div class="rahmen"><table class="tabelle"><thead><tr><th>Rang</th><th>Personen</th><th>Schichten</th><th></th></tr></thead><tbody>
  ${r.map((x, i) => html`<tr>
    <td><form method="post" action="/admin/raenge" class="zeilen-form">${formFelder(kx, z)}<input type="hidden" name="aktion" value="umbenennen"><input type="hidden" name="id" value="${x.id}"><input name="name" value="${x.name}" required maxlength="100" aria-label="Name"><button class="knopf klein" type="submit">Umbenennen</button></form></td>
    <td>${x.personen}</td><td>${x.schichten}</td>
    <td class="knopfreihe">
      ${i > 0 ? knopfPost(kx, '/admin/raenge', 'Höher', { aktion: 'hoeher', id: String(x.id) }, 'knopf klein', z) : ''}
      ${i < r.length - 1 ? knopfPost(kx, '/admin/raenge', 'Tiefer', { aktion: 'tiefer', id: String(x.id) }, 'knopf klein', z) : ''}
      ${Number(x.personen) + Number(x.schichten) === 0 ? knopfPost(kx, '/admin/raenge', 'Löschen', { aktion: 'loeschen', id: String(x.id) }, 'knopf klein gefahr', z) : ''}
    </td></tr>`)}
  </tbody></table></div>
  <form method="post" action="/admin/raenge" class="zeilen-form">${formFelder(kx, z)}<input type="hidden" name="aktion" value="anlegen"><input name="name" required maxlength="100" placeholder="Neuer Rang" aria-label="Neuer Rang"><button class="knopf" type="submit">Rang anlegen</button></form>
</section>
<section class="abschnitt" id="rollen">
  <h2>Rollen</h2>
  <p class="unter">Rollen ohne Teilnehmerzählung (z. B. Sektorchef) zählen beim Essen, aber nicht als Teilnehmende. Umbenennen geht nicht.</p>
  <div class="rahmen"><table class="tabelle"><thead><tr><th>Rolle</th><th>Zählt als Teilnehmer</th><th>Gebraucht</th><th></th></tr></thead><tbody>
  ${ro.map((x, i) => html`<tr><td>${x.name}</td>
    <td>${knopfPost(kx, '/admin/rollen', x.zaehlt_teilnehmer ? 'ja' : 'nein', { aktion: 'zaehlt', name: x.name, zaehlt: x.zaehlt_teilnehmer ? '0' : '1' }, `schalter${x.zaehlt_teilnehmer ? ' an' : ''}`, z)}</td>
    <td>${x.nutzung}</td>
    <td class="knopfreihe">
      ${i > 0 ? knopfPost(kx, '/admin/rollen', 'Hoch', { aktion: 'hoch', name: x.name }, 'knopf klein', z) : ''}
      ${i < ro.length - 1 ? knopfPost(kx, '/admin/rollen', 'Runter', { aktion: 'runter', name: x.name }, 'knopf klein', z) : ''}
      ${Number(x.nutzung) === 0 ? knopfPost(kx, '/admin/rollen', 'Löschen', { aktion: 'loeschen', name: x.name }, 'knopf klein gefahr', z) : ''}
    </td></tr>`)}
  </tbody></table></div>
  <form method="post" action="/admin/rollen" class="zeilen-form">${formFelder(kx, z)}<input type="hidden" name="aktion" value="anlegen"><input name="name" required maxlength="100" placeholder="Neue Rolle" aria-label="Neue Rolle"><label class="haken"><input type="checkbox" name="zaehlt" value="1" checked> zählt als Teilnehmer</label><button class="knopf" type="submit">Rolle anlegen</button></form>
</section>`));
  };
  app.get('/admin/einstellungen', nurAdmin, einstellungen);
  app.get('/admin/raenge', nurAdmin, einstellungen);
  app.get('/admin/rollen', nurAdmin, einstellungen);

  app.post('/admin/raenge', nurAdmin, async (req, res) => {
    const b = req.body ?? {};
    switch (b.aktion) {
      case 'anlegen': await legeRangAn(db, b.name); break;
      case 'umbenennen': await benenneRangUm(db, leseId(b.id), b.name); break;
      case 'hoeher': await verschiebeRang(db, leseId(b.id), 'hoeher'); break;
      case 'tiefer': await verschiebeRang(db, leseId(b.id), 'tiefer'); break;
      case 'loeschen': await loescheRang(db, leseId(b.id)); break;
      default: throw new Eingabefehler('Unbekannte Aktion.');
    }
    zurueck(req, res, '/admin/einstellungen');
  });

  app.post('/admin/rollen', nurAdmin, async (req, res) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name : '';
    switch (b.aktion) {
      case 'anlegen': await legeRolleAn(db, name, b.zaehlt === '1'); break;
      case 'zaehlt': await setzeRolleZaehlt(db, name, b.zaehlt === '1'); break;
      case 'hoch': await verschiebeRolle(db, name, 'hoch'); break;
      case 'runter': await verschiebeRolle(db, name, 'runter'); break;
      case 'loeschen': await loescheRolle(db, name); break;
      default: throw new Eingabefehler('Unbekannte Aktion.');
    }
    zurueck(req, res, '/admin/einstellungen');
  });

  // ---------- Update ----------
  app.get('/admin/update', nurAdmin, (_req, res) => {
    const kx = k(res);
    const u = deps.updater;
    if (!konfig.updateErlaubt || !u) {
      res.send(seite(kx, 'Update', 'update', html`<h1>Update</h1><p>Das Update über diese Seite ist ausgeschaltet. Setze <code>UPDATE_ERLAUBT=1</code> in der Konfiguration.</p>`));
      return;
    }
    const z = u.zustand;
    const phaseText: Record<string, string> = {
      bereit: 'Noch nicht geprüft.', geprueft: 'Geprüft.', laeuft: 'Läuft …', fertig: 'Update fertig. Der Server startet neu.', fehler: 'Fehler.',
    };
    // Die Seite lädt sich während des Updates selbst neu (Header «Refresh», kein Skript nötig).
    if (z.laeuft || z.phase === 'fertig') res.setHeader('Refresh', '3');
    res.send(seite(kx, 'Update', 'update', html`
<h1>Update</h1>
<p>Branch: <code>${konfig.updateBranch}</code>${z.aktuellerCommit ? html` · Aktueller Commit: <code>${z.aktuellerCommit}</code>` : ''}</p>
<p class="meldung ${z.phase === 'fehler' ? 'fehler' : z.phase === 'fertig' ? 'ok' : 'hinweis'}">${phaseText[z.phase]}${z.zeit ? ` (${datumZeit(z.zeit.replace(/\.\d{3}Z$/, 'Z'))})` : ''}</p>
${z.schritte.length ? html`<ol class="schritte">${z.schritte.map((s) => html`<li class="${s.ok === null ? 'laeuft' : s.ok ? 'ok' : 'fehler'}"><strong>${s.ok === null ? '…' : s.ok ? '✔' : '✖'} ${s.text}</strong>${s.ausgabe ? html`<pre>${s.ausgabe}</pre>` : ''}</li>`)}</ol>` : ''}
${z.phase === 'geprueft' ? (z.neueCommits.length
    ? html`<h2>Neue Commits (${z.neueCommits.length})</h2><pre>${z.neueCommits.join('\n')}</pre>
<form method="post" action="/admin/update/starten" class="stapel">
  ${formFelder(kx)}
  <label class="haken wichtig"><input type="checkbox" name="bestaetigt" value="1" required> Datenbank sichern, Update ausführen und den Server neu starten.</label>
  <button type="submit" class="knopf haupt">Update starten</button>
</form>`
    : html`<p>Der Code ist aktuell. Es gibt keine neuen Commits.</p>`) : ''}
${z.laeuft ? '' : html`<form method="post" action="/admin/update/pruefen">${formFelder(kx)}<button type="submit" class="knopf">Auf Updates prüfen</button></form>`}`));
  });

  app.post('/admin/update/pruefen', nurAdmin, async (req, res) => {
    if (!konfig.updateErlaubt || !deps.updater) throw new Eingabefehler('Das Update ist ausgeschaltet.');
    await deps.updater.pruefe();
    res.redirect(303, '/admin/update');
  });

  app.post('/admin/update/starten', nurAdmin, (req, res) => {
    if (!konfig.updateErlaubt || !deps.updater) throw new Eingabefehler('Das Update ist ausgeschaltet.');
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige das Update mit dem Häkchen.');
    if (!deps.updater.starte()) throw new Eingabefehler('Prüfe zuerst auf Updates.');
    res.redirect(303, '/admin/update');
  });
}
