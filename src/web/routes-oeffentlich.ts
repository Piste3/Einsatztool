// Öffentliche Routen: Gesundheit und Anmeldeformular (15, 22.3.3).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { Eingabefehler, liste } from '../domain/eingabe.js';
import {
  Ratenbegrenzung, erstelleFormularToken, pruefeFormularToken, sichtbareSchichten, verarbeiteFormular, type FormularSchicht,
} from '../domain/formular.js';
import { html, mehrzeilig, angehakt, type Roh } from './html.js';
import { lokalesDatum, wochentagKurz, zeitraumText } from '../domain/zeit.js';

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
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

/** Einstellung des Einsatzes: Im Formular ist nur eine Schicht wählbar (Auswahlknöpfe statt Häkchen). */
function nurEine(liste: FormularSchicht[]): boolean {
  return Number(liste[0].einsatz_formular_mehrere) === 0;
}

/** Gewählte Schichten: Häkchen `schichten` und Auswahlknöpfe `schicht_<Einsatz-ID>`. */
function gewaehlteSchichten(b: Record<string, unknown>): string[] {
  const ids = liste(b.schichten);
  for (const [schluessel, wert] of Object.entries(b)) {
    if (/^schicht_\d+$/.test(schluessel)) ids.push(...liste(wert));
  }
  return ids.filter((x) => x !== '');
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
  /** Bemerkung je Einsatz, Schlüssel = Einsatz-ID. */
  bemerkungen?: Record<string, string>;
  schichten?: string[];
}

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
  const gewaehlt = new Set(werte.schichten ?? []);
  const gruppen = new Map<number, FormularSchicht[]>();
  for (const s of schichten) {
    if (!gruppen.has(s.einsatz_id)) gruppen.set(s.einsatz_id, []);
    gruppen.get(s.einsatz_id)!.push(s);
  }
  const token = erstelleFormularToken(deps.konfig.sessionSecret);
  const inhalt = html`
<header class="formular-kopf">
  <h1>Anmeldung für Einsätze</h1>
  <p>Verkehrskadetten · Kadetten-Korps Basel</p>
</header>
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
${schichten.length === 0
    ? html`<div class="formular-karte formular-leer"><p>Zurzeit sind keine Einsätze offen.</p></div>`
    : html`<form method="post" action="/anmeldung" class="formular-form">
  <input type="hidden" name="token" value="${token}">
  <div class="falle" aria-hidden="true">
    <label>Webseite <input type="text" name="webseite" tabindex="-1" autocomplete="off"></label>
  </div>
  <section class="formular-karte">
    <h2 class="formular-schritt"><span>1</span> Deine Angaben</h2>
    <div class="formular-namen">
      <div class="feld"><label for="vorname">Vorname</label><input id="vorname" name="vorname" required maxlength="100" autocomplete="given-name" value="${werte.vorname ?? ''}"></div>
      <div class="feld"><label for="nachname">Nachname</label><input id="nachname" name="nachname" required maxlength="100" autocomplete="family-name" value="${werte.nachname ?? ''}"></div>
    </div>
  </section>
  <fieldset class="schichten">
    <legend class="formular-schritt"><span>2</span> Einsätze und Schichten</legend>
    ${[...gruppen.values()].map((liste) => html`
    <section class="formular-karte einsatz-gruppe">
      <h3>${liste[0].einsatz_name}</h3>
      ${liste[0].einsatz_bemerkung_extern ? html`<p class="einsatz-info">${mehrzeilig(liste[0].einsatz_bemerkung_extern)}</p>` : ''}
      ${nurEine(liste) ? html`<p class="nur-eine">Wähle höchstens eine Schicht.</p>` : ''}
      <div class="schicht-liste">
      ${liste.map((s) => html`
      <label class="schicht-wahl">
        ${nurEine(liste)
          ? html`<input type="radio" name="schicht_${s.einsatz_id}" value="${s.id}"${angehakt(gewaehlt.has(String(s.id)))}>`
          : html`<input type="checkbox" name="schichten" value="${s.id}"${angehakt(gewaehlt.has(String(s.id)))}>`}
        <span class="schicht-datum" aria-hidden="true"><small>${wochentagKurz(s.start_zeit)}</small><strong>${lokalesDatum(s.start_zeit).slice(8, 10)}</strong><small>${MONATE[Number(lokalesDatum(s.start_zeit).slice(5, 7)) - 1]}</small></span>
        <span class="schicht-text">
          <strong>${s.name}</strong>
          <span class="zeit">${zeitraumText(s.start_zeit, s.end_zeit)}</span>
          ${hinweisVorgaben(s) ? html`<span class="vorgabe">${hinweisVorgaben(s)}</span>` : ''}
          ${s.bemerkung_extern ? html`<span class="bemerkung">${mehrzeilig(s.bemerkung_extern)}</span>` : ''}
        </span>
        <span class="schicht-haken" aria-hidden="true"></span>
      </label>`)}
      ${nurEine(liste) ? html`
      <label class="schicht-wahl keine-schicht">
        <input type="radio" name="schicht_${liste[0].einsatz_id}" value=""${angehakt(!liste.some((s) => gewaehlt.has(String(s.id))))}>
        <span class="schicht-text"><strong>Keine Schicht in diesem Einsatz</strong></span>
        <span class="schicht-haken" aria-hidden="true"></span>
      </label>` : ''}
      </div>
      <div class="feld einsatz-bemerkung"><label for="bemerkung_${liste[0].einsatz_id}">Bemerkungen</label><textarea id="bemerkung_${liste[0].einsatz_id}" name="bemerkung_${liste[0].einsatz_id}" maxlength="2000" rows="2">${werte.bemerkungen?.[String(liste[0].einsatz_id)] ?? ''}</textarea></div>
    </section>`)}
  </fieldset>
  <div class="formular-senden"><button type="submit" class="knopf haupt">Anmelden</button></div>
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
