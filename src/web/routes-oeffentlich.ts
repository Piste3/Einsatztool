// Öffentliche Routen: Gesundheit und Anmeldeformular (15, 22.3.3).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { Eingabefehler, liste } from '../domain/eingabe.js';
import {
  Ratenbegrenzung, erstelleFormularToken, pruefeFormularToken, sichtbareSchichten, verarbeiteFormular,
} from '../domain/formular.js';
import { html, type Roh } from './html.js';
import { anmeldeformularHtml, type FormularWerte } from './views/anmeldeformular.js';
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

/** Gewählte Schichten: Häkchen `schichten` und Auswahlknöpfe `schicht_<Einsatz-ID>`. */
function gewaehlteSchichten(b: Record<string, unknown>): string[] {
  const ids = liste(b.schichten);
  for (const [schluessel, wert] of Object.entries(b)) {
    if (/^schicht_\d+$/.test(schluessel)) ids.push(...liste(wert));
  }
  return ids.filter((x) => x !== '');
}

type Werte = FormularWerte;

/** Liest die Felder «bemerkung_<Einsatz-ID>» aus dem Formular. */
function bemerkungenJeEinsatz(b: Record<string, unknown>): Record<string, string> {
  const ergebnis: Record<string, string> = {};
  for (const [feld, wert] of Object.entries(b)) {
    const m = /^bemerkung_(\d{1,10})$/.exec(feld);
    if (m && typeof wert === 'string') ergebnis[m[1]] = wert;
  }
  return ergebnis;
}

async function zeigeFormular(deps: Abhaengigkeiten, res: Response, werte: Werte = {}, fehler: string | null = null, status = 200): Promise<void> {
  const schichten = await sichtbareSchichten(deps.db);
  const token = erstelleFormularToken(deps.konfig.sessionSecret);
  const inhalt = anmeldeformularHtml(schichten, werte, { art: 'ausfuellen', token }, fehler);
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
      bemerkungen: bemerkungenJeEinsatz(b),
      schichten: gewaehlteSchichten(b),
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
      await verarbeiteFormular(deps.db, { vorname: b.vorname, nachname: b.nachname, bemerkungen: werte.bemerkungen, schichten: werte.schichten });
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
      formularSeite(html`<div class="formular-karte formular-danke">
<span class="danke-zeichen" aria-hidden="true">✓</span>
<h1>Danke</h1>
<p>Danke für deine Anmeldung. Sie gilt erst, wenn die Aufgebotsstelle sie bestätigt. Du bekommst dann eine Mail an deine Adresse aus Clubdesk.</p>
<p><a class="knopf" href="/anmeldung">Weitere Anmeldung</a></p>
</div>`),
    );
  });
}
