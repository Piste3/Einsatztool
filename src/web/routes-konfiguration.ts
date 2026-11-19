// Admin › Konfiguration: alle Werte aus einsatzplaner.env sehen und ändern (Entscheid Yann 19.11.2026).
// Nur für Admins. Jede Änderung steht im Protokoll. Geheimnisse gehen nie an den Browser zurück.
import type { Express, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import type { Abhaengigkeiten } from './app.js';
import { nurAdmin, zurueck } from './app.js';
import { ausUmgebung, envDateiPfad } from '../config.js';
import { testeVerbindung } from '../db/db.js';
import {
  DatenbankNichtErreichbar, GRUPPEN, KonfigKonflikt, erstelleQuelle, kuenftigeWerte, letzteKonfigAenderungen, speichereKonfiguration, zeilen,
  type Quelle, type Zeile,
} from '../domain/konfiguration.js';
import { Eingabefehler } from '../domain/eingabe.js';
import { ABSENDER_NAME } from '../domain/mail-vorlagen.js';
import { smtpOptionen } from '../jobs/mail-worker.js';
import { log } from '../log.js';
import { html, Roh } from './html.js';
import { k, type Kontext } from './kontext.js';
import { formFelder, seite, seitenKopf } from './views/layout.js';
import { datumZeit } from './views/teile.js';

const PFAD = '/admin/konfiguration';

interface Zustand {
  /** Eingaben nach einem Fehler. Sie bleiben im Formular stehen. */
  eingaben?: Record<string, unknown>;
  fehler?: string;
  version?: string;
  /** Die Datenbank war nicht erreichbar: Häkchen «Trotzdem speichern» zeigen. */
  dbFehler?: boolean;
}

function feld(z: Zeile, eingaben: Record<string, unknown> | undefined): Roh {
  const d = z.d;
  const id = `w_${d.schluessel}`;
  const wert = eingaben && typeof eingaben[id] === 'string' && d.art !== 'geheim' ? (eingaben[id] as string) : z.wert;
  const marken = html`${z.neustartNoetig ? html` <span class="pille orange">wirkt nach Neustart</span>` : ''}${
    d.art === 'geheim' ? html` <span class="pille ${z.gesetzt ? 'gruen' : 'grau'}">${z.gesetzt ? 'gesetzt' : 'leer'}</span>` : ''}`;
  const kopf = html`<label for="${id}">${d.titel} <code>${d.schluessel}</code>${marken}</label>`;
  const hilfe = html`${d.hilfe ? html`<p class="unter">${d.hilfe}</p>` : ''}${d.heikel ? html`<p class="unter warn-text">Ein falscher Wert sperrt den Zugang. Dann hilft nur die Datei auf dem Server.</p>` : ''}`;
  if (z.gesperrt) {
    return html`<div class="feld">${kopf}<input id="${id}" value="${d.art === 'geheim' ? (z.gesetzt ? '••••••••' : '') : wert}" disabled>
      <p class="unter">Dieser Wert kommt aus einer Umgebungsvariablen. Du kannst ihn nur auf dem Server ändern.</p></div>`;
  }
  let eingabe: Roh;
  switch (d.art) {
    case 'geheim':
      eingabe = html`<input id="${id}" name="${id}" type="password" autocomplete="new-password" placeholder="${z.gesetzt ? 'Leer lassen = unverändert' : 'Nicht gesetzt'}">
        ${d.schluessel === 'SESSION_SECRET' ? html`<label class="haken"><input type="checkbox" name="erzeugen_${d.schluessel}" value="1"> Neuen zufälligen Schlüssel erzeugen</label>` : ''}
        ${!d.pflicht && z.gesetzt ? html`<label class="haken"><input type="checkbox" name="leeren_${d.schluessel}" value="1"> Wert löschen</label>` : ''}`;
      break;
    case 'janein':
      eingabe = html`<select id="${id}" name="${id}"><option value="1"${wert === '1' ? new Roh(' selected') : ''}>ja</option><option value="0"${wert !== '1' ? new Roh(' selected') : ''}>nein</option></select>`;
      break;
    case 'port':
      eingabe = html`<input id="${id}" name="${id}" type="number" min="1" max="65535" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
      break;
    case 'stunde':
      eingabe = html`<input id="${id}" name="${id}" type="number" min="0" max="23" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
      break;
    case 'mail':
      eingabe = html`<input id="${id}" name="${id}" type="email" maxlength="1000" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
      break;
    case 'url':
      eingabe = html`<input id="${id}" name="${id}" type="url" maxlength="1000" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
      break;
    default:
      eingabe = html`<input id="${id}" name="${id}" maxlength="1000" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
  }
  return html`<div class="feld">${kopf}${eingabe}${hilfe}</div>`;
}

async function konfigSeite(deps: Abhaengigkeiten, kx: Kontext, q: Quelle, z: Zustand = {}): Promise<string> {
  const stand = zeilen(q);
  const protokoll = await letzteKonfigAenderungen(deps.db);
  const neustart = stand.zeilen.some((x) => x.neustartNoetig);
  return seite(kx, 'Konfiguration', 'konfiguration', html`
<p><a href="/admin/einstellungen">← Einstellungen</a></p>
${seitenKopf({ titel: 'Konfiguration' })}
<p>Diese Werte stehen in der Datei <code>${q.pfad}</code>. Die Seite liest und schreibt diese Datei. Änderungen wirken erst nach einem Neustart des Servers.</p>
<p class="unter">Passwörter und Schlüssel zeigt die Seite nie an. Ein leeres Feld lässt den Wert unverändert. Der alte Stand der Datei bleibt als <code>.vorher</code> daneben.</p>
${neustart ? html`<div class="meldung hinweis">Einige Werte sind gespeichert, aber noch nicht aktiv. <a href="#neustart">Starte den Server neu.</a></div>` : ''}
${z.fehler ? html`<div class="meldung fehler" role="alert">${z.fehler}</div>` : ''}
<form method="post" action="${PFAD}" class="stapel">
  ${formFelder(kx)}
  <input type="hidden" name="version" value="${z.version ?? stand.version}">
  ${GRUPPEN.map((g) => html`<section class="abschnitt"><h2>${g}</h2>${stand.zeilen.filter((x) => x.d.gruppe === g).map((x) => feld(x, z.eingaben))}</section>`)}
  ${z.dbFehler ? html`<label class="haken wichtig"><input type="checkbox" name="trotzdem" value="1"> Trotzdem speichern. Nach dem Neustart startet der Server vermutlich nicht.</label>` : ''}
  <div class="knopfreihe"><button type="submit" class="knopf haupt">Speichern</button></div>
</form>
<section class="abschnitt" id="neustart">
  <h2>Server neu starten</h2>
  ${deps.neustart
    ? html`<p>Der Server beendet sich. Das Startskript startet ihn nach 3 Sekunden neu. Laufende Arbeit anderer Benutzer geht nicht verloren, offene Formulare müssen sie neu senden.</p>
  <form method="post" action="${PFAD}/neustart" class="stapel" data-normal>${formFelder(kx)}
    <label class="haken wichtig"><input type="checkbox" name="bestaetigt" value="1" required> Server jetzt neu starten.</label>
    <button type="submit" class="knopf">Neu starten</button></form>`
    : html`<p class="unter">Ein Neustart über diese Seite ist hier nicht möglich.</p>`}
</section>
<section class="abschnitt" id="smtp">
  <h2>SMTP testen</h2>
  <p>Das Tool sendet eine Testmail mit den gespeicherten Werten. Speichere neue Werte zuerst.</p>
  <form method="post" action="${PFAD}/smtp-test" class="zeilen-form">${formFelder(kx)}
    <input name="an" type="email" required maxlength="200" value="${kx.benutzer!.email ?? ''}" aria-label="Empfänger">
    <button type="submit" class="knopf">Testmail senden</button></form>
</section>
<section class="abschnitt" id="protokoll">
  <h2>Protokoll</h2>
  ${protokoll.length
    ? html`<div class="rahmen"><table class="tabelle"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Wert</th><th>Alt</th><th>Neu</th></tr></thead><tbody>
    ${protokoll.map((p) => html`<tr><td>${datumZeit(p.zeit)}</td><td>${p.benutzer ?? ''}</td><td><code>${p.schluessel}</code></td><td>${p.alt || '–'}</td><td>${p.neu || '–'}</td></tr>`)}
    </tbody></table></div>`
    : html`<p class="unter">Noch keine Änderung über diese Seite.</p>`}
</section>`);
}

export function registriereKonfiguration(app: Express, deps: Abhaengigkeiten): void {
  const quelle = (): Quelle => deps.konfigQuelle ?? erstelleQuelle(envDateiPfad(), process.env, ausUmgebung);
  // Ohne Angabe gilt der Stand beim Erstellen der App als «laufend».
  const q0 = quelle();
  const q = () => deps.konfigQuelle ?? q0;

  app.get(PFAD, nurAdmin, async (_req, res) => {
    res.send(await konfigSeite(deps, k(res), q()));
  });

  app.post(PFAD, nurAdmin, async (req: Request, res: Response) => {
    const kx = k(res);
    const eingaben = (req.body ?? {}) as Record<string, unknown>;
    try {
      const aenderungen = await speichereKonfiguration(deps.db, q(), eingaben, kx.benutzer!.id, {
        testeDatenbank: testeVerbindung,
        trotzdem: eingaben.trotzdem === '1',
      });
      if (aenderungen.length) log('info', `Konfiguration geändert von ${kx.benutzer!.name}: ${aenderungen.map((a) => a.schluessel).join(', ')}.`);
      zurueck(req, res, PFAD, aenderungen.length
        ? `Gespeichert: ${aenderungen.length} Wert${aenderungen.length === 1 ? '' : 'e'}. Die Änderung wirkt nach einem Neustart.`
        : 'Keine Änderung.');
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      // Die Eingaben bleiben stehen. Nach einem Konflikt überschreibt ein zweites Speichern bewusst.
      const konflikt = e instanceof KonfigKonflikt;
      res.status(konflikt ? 409 : 400).send(await konfigSeite(deps, kx, q(), {
        eingaben,
        fehler: `${e.message}${konflikt ? '' : ' Gib Passwörter und Schlüssel erneut ein.'}`,
        version: konflikt ? e.aktuelleVersion : typeof eingaben.version === 'string' ? eingaben.version : undefined,
        dbFehler: e instanceof DatenbankNichtErreichbar,
      }));
    }
  });

  app.post(`${PFAD}/neustart`, nurAdmin, (req, res) => {
    if (!deps.neustart) throw new Eingabefehler('Ein Neustart über diese Seite ist hier nicht möglich.');
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige den Neustart mit dem Häkchen.');
    log('info', `Neustart über Admin › Konfiguration durch ${k(res).benutzer!.name}.`);
    // Die Seite lädt sich nach 10 Sekunden selbst neu (Header «Refresh», kein Skript nötig).
    res.setHeader('Refresh', `10; url=${PFAD}`);
    res.send(seite(k(res), 'Neustart', 'konfiguration', html`${seitenKopf({ titel: 'Neustart' })}<p class="meldung hinweis">Der Server startet neu. Die Seite lädt sich in 10 Sekunden neu.</p>`));
    const neustart = deps.neustart;
    setTimeout(() => neustart(), 300).unref();
  });

  app.post(`${PFAD}/smtp-test`, nurAdmin, async (req, res) => {
    const an = typeof req.body?.an === 'string' ? req.body.an.trim() : '';
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(an) || an.length > 200) throw new Eingabefehler('Gib eine gültige Mail-Adresse ein.');
    const w = kuenftigeWerte(q());
    if (!w.SMTP_HOST) throw new Eingabefehler('SMTP-Server fehlt. Speichere zuerst die Werte.');
    const transport = nodemailer.createTransport({
      ...smtpOptionen({ host: w.SMTP_HOST, port: Number(w.SMTP_PORT) || 587, user: w.SMTP_USER, pass: w.SMTP_PASS }),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transport.sendMail({
        from: `"${ABSENDER_NAME}" <${w.MAIL_FROM}>`,
        to: an,
        subject: 'Testmail Einsatzplaner',
        text: 'Diese Testmail kommt vom Einsatzplaner. Der Mail-Versand funktioniert.',
      });
      zurueck(req, res, `${PFAD}#smtp`, `Testmail an ${an} gesendet.`);
    } catch (e) {
      zurueck(req, res, `${PFAD}#smtp`, `Testmail nicht gesendet: ${(e as Error).message}`, 'fehler');
    } finally {
      transport.close();
    }
  });
}
