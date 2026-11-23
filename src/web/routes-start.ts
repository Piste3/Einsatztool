// Startseite «Cockpit» mit «Zu tun» (Abschnitt 3 des Auftrags, 14.1 GET /).
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { leseCookies, nurAufgebot } from './app.js';
import { ANSICHT_COOKIE, startInHandy } from '../domain/handy.js';
import { startUebersicht } from '../domain/listen.js';
import { html, type Roh } from './html.js';
import { k } from './kontext.js';
import { seite, seitenKopf } from './views/layout.js';
import { istSoll, knopfPost, punktMarke, publiziertMarke, zeitraum } from './views/teile.js';
import { jetztIso } from '../domain/zeit.js';

const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Heutiges Datum in Zürcher Zeit, z. B. «Donnerstag, 19. November 2026». */
function heuteText(): string {
  const teile = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
    .formatToParts(new Date());
  const wert = (t: string) => Number(teile.find((p) => p.type === t)?.value);
  const tag = new Date(Date.UTC(wert('year'), wert('month') - 1, wert('day')));
  return `${WOCHENTAG[tag.getUTCDay()]}, ${wert('day')}. ${MONAT[wert('month') - 1]} ${wert('year')}`;
}

function tageBis(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));
}

export function registriereStart(app: Express, deps: Abhaengigkeiten): void {
  app.get('/', nurAufgebot, async (req, res) => {
    const kx = k(res);
    // Handyversion (Wunsch Yann 23.11.2026): Auf einem Smartphone öffnet die Startseite die Handyversion,
    // ausser der Benutzer hat die volle Version gewählt (Cookie «ansicht=voll»).
    if (startInHandy(req.get('user-agent'), leseCookies(req)[ANSICHT_COOKIE])) {
      res.redirect(302, '/m');
      return;
    }
    const u = await startUebersicht(deps.db);
    const jetzt = jetztIso();

    // «Zu tun»: konkrete Punkte aus denselben Zahlen wie bisher. Ein Klick öffnet die passende Seite.
    const punkte: Roh[] = [];
    const punkt = (marke: Roh, text: string, href: string) => html`<li><a href="${href}">${marke}<span>${text}</span></a></li>`;
    if (u.unbekannt > 0) {
      punkte.push(punkt(punktMarke('Klären', 'orange'), `${u.unbekannt} ${u.unbekannt === 1 ? 'Anmeldung' : 'Anmeldungen'} ohne Zuordnung`, '/anmeldungen/unbekannt'));
    }
    for (const e of u.einsaetze) {
      if (e.unbestaetigt > 0) punkte.push(punkt(punktMarke('Bestätigen', 'blau'), `${e.name}: ${e.unbestaetigt} ${e.unbestaetigt === 1 ? 'Anmeldung' : 'Anmeldungen'} bestätigen`, `/einsaetze/${e.id}`));
    }
    for (const e of u.einsaetze) {
      for (const s of e.schichten) {
        if (s.end_zeit <= jetzt || s.soll_anzahl === null || s.zahlen.teilnehmende >= s.soll_anzahl) continue;
        const fehlt = s.soll_anzahl - s.zahlen.teilnehmende;
        const name = e.schichten.length > 1 ? `${e.name} – ${s.name}` : e.name;
        punkte.push(punkt(punktMarke('Nachfassen', 'rot'), `${name}: ${fehlt} ${fehlt === 1 ? 'Person fehlt' : 'Personen fehlen'}`, `/schichten/${s.id}/anrufliste`));
      }
    }
    for (const e of u.einsaetze) {
      if (e.warnungen > 0) punkte.push(punkt(punktMarke('Warnungen', 'orange'), `${e.name}: ${e.warnungen} ${e.warnungen === 1 ? 'Warnung' : 'Warnungen'} prüfen`, `/einsaetze/${e.id}`));
    }
    const naechster = u.einsaetze.find((e) => e.schichten.some((s) => s.end_zeit > jetzt));
    const naechsterStart = naechster?.schichten.find((s) => s.end_zeit > jetzt)?.start_zeit;

    const inhalt = html`
${seitenKopf({ ueber: heuteText(), titel: 'Cockpit', aktionen: html`<a class="knopf haupt" href="/einsaetze/neu">+ Neuer Einsatz</a>` })}
<section class="karte zu-tun" aria-labelledby="zu-tun-titel">
  <div class="karte-kopf">
    <h2 id="zu-tun-titel">Zu tun <small>${punkte.length} ${punkte.length === 1 ? 'Punkt' : 'Punkte'}</small></h2>
    ${naechster && naechsterStart ? html`<span class="unter">Nächster Einsatz: <a href="/einsaetze/${naechster.id}">${naechster.name}</a> ${tageBis(naechsterStart) === 0 ? 'heute' : `in ${tageBis(naechsterStart)} ${tageBis(naechsterStart) === 1 ? 'Tag' : 'Tagen'}`}</span>` : ''}
  </div>
  ${punkte.length === 0 ? html`<p class="zu-tun-leer">Nichts zu tun. Alle Anmeldungen sind bearbeitet.</p>` : html`
  <ul class="zu-tun-liste">${punkte.slice(0, 6)}</ul>
  ${punkte.length > 6 ? html`<details class="gruppe zu-tun-mehr"><summary class="zu-tun-leer">${punkte.length - 6 === 1 ? '1 weiterer Punkt' : `${punkte.length - 6} weitere Punkte`} anzeigen</summary><ul class="zu-tun-liste">${punkte.slice(6)}</ul></details>` : ''}`}
</section>

<div class="zahl-karten">
  <a class="zahl-karte${u.unbestaetigt ? ' orange' : ''}" href="#einsaetze"><span class="wert">${u.unbestaetigt}</span><span class="titel">Unbestätigte Anmeldungen</span></a>
  <a class="zahl-karte${u.unbekannt ? ' orange' : ''}" href="/anmeldungen/unbekannt"><span class="wert">${u.unbekannt}</span><span class="titel">Unbekannte Anmeldungen</span></a>
  <a class="zahl-karte${u.unterSoll ? ' rot' : ''}" href="#einsaetze"><span class="wert">${u.unterSoll}</span><span class="titel">Schichten unter Soll</span></a>
  <a class="zahl-karte${u.mitWarnungen ? ' orange' : ''}" href="#einsaetze"><span class="wert">${u.mitWarnungen}</span><span class="titel">Schichten mit Warnungen</span></a>
</div>

<h2 id="einsaetze">Anstehende Einsätze</h2>
${u.einsaetze.length === 0 ? html`<p class="leer">Keine kommenden Einsätze. <a href="/einsaetze/neu">Einsatz erstellen</a></p>` : ''}
<div class="karten">
${u.einsaetze.map((e) => html`
  <section class="karte ohne-rand einsatz-karte">
    <div class="karte-kopf">
      <h3><a href="/einsaetze/${e.id}">${e.name}</a>${e.ort ? html` <small>· ${e.ort}</small>` : ''}</h3>
      ${e.unbestaetigt > 0 ? knopfPost(kx, `/einsaetze/${e.id}/alle-bestaetigen`, `Alle ${e.unbestaetigt} bestätigen`, {}, 'knopf klein', '/') : ''}
    </div>
    <div class="rahmen-innen"><table class="tabelle kompakt">
      <thead><tr><th>Schicht</th><th>Zeit</th><th>Ist / Soll</th><th>Unbestätigt</th><th>Warnungen</th></tr></thead>
      <tbody>
      ${e.schichten.map((s) => html`<tr class="${s.end_zeit <= jetzt ? 'vergangen' : ''}">
        <td><a href="/schichten/${s.id}">${s.name}</a>${s.publiziert ? '' : html` ${publiziertMarke(false)}`}</td>
        <td>${zeitraum(s.start_zeit, s.end_zeit)}</td>
        <td>${istSoll(s.zahlen.teilnehmende, s.soll_anzahl)}</td>
        <td>${s.zahlen.unbestaetigt ? html`<span class="pille orange">${s.zahlen.unbestaetigt}</span>` : '0'}</td>
        <td>${s.warnungen ? html`<span class="pille warn">⚠ ${s.warnungen}</span>` : '–'}</td>
      </tr>`)}
      </tbody>
    </table></div>
  </section>`)}
</div>`;
    res.send(seite(kx, 'Cockpit', 'start', inhalt));
  });
}
