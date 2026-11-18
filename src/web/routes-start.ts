// Startseite «Zu tun» (Abschnitt 3 des Auftrags, 14.1 GET /).
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot } from './app.js';
import { startUebersicht } from '../domain/listen.js';
import { html } from './html.js';
import { k } from './kontext.js';
import { seite } from './views/layout.js';
import { istSoll, knopfPost, zeitraum } from './views/teile.js';
import { jetztIso } from '../domain/zeit.js';

export function registriereStart(app: Express, deps: Abhaengigkeiten): void {
  app.get('/', nurAufgebot, async (_req, res) => {
    const kx = k(res);
    const u = await startUebersicht(deps.db);
    const jetzt = jetztIso();
    const kachel = (titel: string, wert: number, href: string, art: string) =>
      html`<a class="kachel ${wert > 0 ? art : 'ruhig'}" href="${href}"><span class="wert">${wert}</span><span class="titel">${titel}</span></a>`;
    const inhalt = html`
<h1>Zu tun</h1>
<div class="kacheln">
  ${kachel('Unbestätigte Anmeldungen', u.unbestaetigt, '#einsaetze', 'orange')}
  ${kachel('Unbekannte Anmeldungen', u.unbekannt, '/anmeldungen/unbekannt', 'orange')}
  ${kachel('Schichten unter Soll', u.unterSoll, '#einsaetze', 'rot')}
  ${kachel('Schichten mit Warnungen', u.mitWarnungen, '#einsaetze', 'orange')}
</div>
<h2 id="einsaetze">Kommende Einsätze</h2>
${u.einsaetze.length === 0 ? html`<p class="leer">Keine kommenden Einsätze. <a href="/einsaetze/neu">Einsatz erstellen</a></p>` : ''}
<div class="karten">
${u.einsaetze.map((e) => html`
  <section class="karte einsatz-karte">
    <header>
      <h3><a href="/einsaetze/${e.id}">${e.name}</a></h3>
      ${e.ort ? html`<span class="unter">${e.ort}</span>` : ''}
    </header>
    <table class="tabelle kompakt">
      <thead><tr><th>Schicht</th><th>Zeit</th><th>Ist / Soll</th><th>Unbestätigt</th><th>Warnungen</th></tr></thead>
      <tbody>
      ${e.schichten.map((s) => html`<tr class="${s.end_zeit <= jetzt ? 'vergangen' : ''}">
        <td><a href="/schichten/${s.id}">${s.name}</a>${s.publiziert ? '' : html` <span class="pille grau">intern</span>`}</td>
        <td>${zeitraum(s.start_zeit, s.end_zeit)}</td>
        <td>${istSoll(s.zahlen.teilnehmende, s.soll_anzahl)}</td>
        <td>${s.zahlen.unbestaetigt ? html`<span class="pille orange">${s.zahlen.unbestaetigt}</span>` : '0'}</td>
        <td>${s.warnungen ? html`<span class="pille warn">⚠ ${s.warnungen}</span>` : '–'}</td>
      </tr>`)}
      </tbody>
    </table>
    ${e.unbestaetigt > 0 ? html`<footer>${knopfPost(kx, `/einsaetze/${e.id}/alle-bestaetigen`, `Alle bestätigen (${e.unbestaetigt})`, {}, 'knopf haupt', '/')}</footer>` : ''}
  </section>`)}
</div>`;
    res.send(seite(kx, 'Zu tun', 'start', inhalt));
  });
}
