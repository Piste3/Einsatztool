// Öffentliche Routen: Gesundheit und Anmeldeformular (15, 22.3.3).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { Eingabefehler, liste } from '../domain/eingabe.js';
import {
  Ratenbegrenzung, erstelleFormularToken, pruefeFormularToken, sichtbareSchichten, verarbeiteFormular, type FormularSchicht,
} from '../domain/formular.js';
import { html, mehrzeilig, angehakt, type Roh } from './html.js';
import { zeitraumText } from '../domain/zeit.js';
import { log } from '../log.js';

function formularSeite(inhalt: Roh): string {
  return `<!doctype html>${html`<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Anmeldung · Verkehrskadetten</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="formular">
<main class="formular-inhalt">${inhalt}</main>
</body>
</html>`}`;
}

function hinweisVorgaben(s: FormularSchicht): string {
  const teile: string[] = [];
  if (s.min_alter !== null) teile.push(`Nur ${s.min_alter}+`);
  if (s.min_rang_name) teile.push(`ab ${s.min_rang_name}`);
  return teile.join(' · ');
}

interface Werte {
  vorname?: string;
  nachname?: string;
  email?: string;
  bemerkung?: string;
  essen?: string;
  schichten?: string[];
}

async function zeigeFormular(deps: Abhaengigkeiten, res: Response, werte: Werte = {}, fehler: string | null = null, status = 200): Promise<void> {
  const schichten = await sichtbareSchichten(deps.db);
  const gewaehlt = new Set(werte.schichten ?? []);
  const gruppen = new Map<number, FormularSchicht[]>();
  for (const s of schichten) {
    if (!gruppen.has(s.einsatz_id)) gruppen.set(s.einsatz_id, []);
    gruppen.get(s.einsatz_id)!.push(s);
  }
  const token = erstelleFormularToken(deps.konfig.sessionSecret);
  const inhalt = html`
<h1>Anmeldung für Einsätze</h1>
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
${schichten.length === 0
    ? html`<p>Zurzeit sind keine Einsätze offen.</p>`
    : html`<form method="post" action="/anmeldung" class="formular-form">
  <input type="hidden" name="token" value="${token}">
  <div class="falle" aria-hidden="true">
    <label>Webseite <input type="text" name="webseite" tabindex="-1" autocomplete="off"></label>
  </div>
  <div class="feld"><label for="vorname">Vorname</label><input id="vorname" name="vorname" required maxlength="100" autocomplete="given-name" value="${werte.vorname ?? ''}"></div>
  <div class="feld"><label for="nachname">Nachname</label><input id="nachname" name="nachname" required maxlength="100" autocomplete="family-name" value="${werte.nachname ?? ''}"></div>
  <div class="feld"><label for="email">E-Mail</label><input id="email" name="email" type="email" required maxlength="255" autocomplete="email" value="${werte.email ?? ''}"></div>
  <fieldset class="schichten">
    <legend>Einsätze und Schichten</legend>
    ${[...gruppen.values()].map((liste) => html`
    <div class="einsatz-gruppe">
      <h2>${liste[0].einsatz_name}</h2>
      ${liste[0].einsatz_bemerkung_extern ? html`<p class="bemerkung">${mehrzeilig(liste[0].einsatz_bemerkung_extern)}</p>` : ''}
      ${liste.map((s) => html`
      <label class="schicht-wahl">
        <input type="checkbox" name="schichten" value="${s.id}"${angehakt(gewaehlt.has(String(s.id)))}>
        <span>
          <strong>${s.name}</strong>
          <span class="zeit">${zeitraumText(s.start_zeit, s.end_zeit)}</span>
          ${s.ort ? html`<span class="ort">${s.ort}</span>` : ''}
          ${hinweisVorgaben(s) ? html`<span class="vorgabe">${hinweisVorgaben(s)}</span>` : ''}
          ${s.bemerkung_extern ? html`<span class="bemerkung">${mehrzeilig(s.bemerkung_extern)}</span>` : ''}
        </span>
      </label>`)}
    </div>`)}
  </fieldset>
  <div class="feld"><label for="essen">Essenseinschränkungen</label><input id="essen" name="essen" maxlength="500" value="${werte.essen ?? ''}"><small>Nur ausfüllen, wenn neu oder geändert.</small></div>
  <div class="feld"><label for="bemerkung">Bemerkung</label><textarea id="bemerkung" name="bemerkung" maxlength="2000" rows="3">${werte.bemerkung ?? ''}</textarea></div>
  <button type="submit" class="knopf haupt">Anmelden</button>
</form>`}`;
  res.status(status).type('html').send(formularSeite(inhalt));
}

export function registriereOeffentlich(app: Express, deps: Abhaengigkeiten): void {
  const grenze = new Ratenbegrenzung(20, 60 * 60 * 1000);

  app.get('/health', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  app.get('/anmeldung', async (_req, res) => {
    await zeigeFormular(deps, res);
  });

  app.post('/anmeldung', async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const werte: Werte = {
      vorname: typeof b.vorname === 'string' ? b.vorname : '',
      nachname: typeof b.nachname === 'string' ? b.nachname : '',
      email: typeof b.email === 'string' ? b.email : '',
      bemerkung: typeof b.bemerkung === 'string' ? b.bemerkung : '',
      essen: typeof b.essen === 'string' ? b.essen : '',
      schichten: liste(b.schichten),
    };
    // Grenze: 20 Anfragen pro Stunde je IP-Adresse (15.2).
    if (!grenze.erlaubt(req.ip ?? 'unbekannt')) {
      await zeigeFormular(deps, res, werte, 'Zu viele Anfragen. Versuche es später erneut.', 429);
      return;
    }
    // Honeypot (15.2): gefüllt = verwerfen ohne Fehlermeldung.
    if (typeof b.webseite === 'string' && b.webseite.trim() !== '') {
      log('info', 'Formular: Honeypot gefüllt, Anfrage verworfen.');
      res.redirect(303, '/anmeldung/danke');
      return;
    }
    const token = pruefeFormularToken(deps.konfig.sessionSecret, b.token);
    if (token === 'zu_schnell') {
      await zeigeFormular(deps, res, werte, 'Das ging zu schnell. Prüfe deine Angaben und sende das Formular erneut.', 400);
      return;
    }
    if (token !== 'ok') {
      await zeigeFormular(deps, res, werte, 'Das Formular ist abgelaufen. Sende es bitte erneut.', 400);
      return;
    }
    try {
      await verarbeiteFormular(deps.db, b);
    } catch (e) {
      if (e instanceof Eingabefehler) {
        await zeigeFormular(deps, res, werte, e.message, 400);
        return;
      }
      throw e;
    }
    res.redirect(303, '/anmeldung/danke');
  });

  app.get('/anmeldung/danke', (_req, res) => {
    res.type('html').send(
      formularSeite(html`<h1>Danke</h1>
<p>Danke für deine Anmeldung. Sie gilt erst, wenn die Aufgebotsstelle sie bestätigt. Du bekommst dann eine Mail.</p>
<p><a href="/anmeldung">Weitere Anmeldung</a></p>`),
    );
  });
}
