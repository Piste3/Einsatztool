// Admin › Einstellungen (Reiter Mail, Login, Clubdesk und Export, Server, Protokoll): alle Werte aus einsatzplaner.env sehen und ändern (Entscheid Yann 19.11.2026).
// Nur für Admins. Jede Änderung steht im Protokoll. Geheimnisse gehen nie an den Browser zurück.
import type { Express, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import type { Abhaengigkeiten } from './app.js';
import { nurAdmin, zurueck } from './app.js';
import { ausUmgebung, envDateiPfad } from '../config.js';
import { testeVerbindung } from '../db/db.js';
import {
  DEFINITIONEN, DatenbankNichtErreichbar, KonfigKonflikt, erstelleQuelle, kuenftigeWerte, letzteKonfigAenderungen, speichereKonfiguration, zeilen,
  type Quelle, type Zeile,
} from '../domain/konfiguration.js';
import { Eingabefehler } from '../domain/eingabe.js';
import { ablaufText, entraAblauf, inZweiJahren, type EntraAblauf } from '../domain/entra-schluessel.js';
import { datumCh } from '../domain/zeit.js';
import { ABSENDER_NAME } from '../domain/mail-vorlagen.js';
import { smtpOptionen } from '../jobs/mail-worker.js';
import { log } from '../log.js';
import { html, Roh } from './html.js';
import { k, type Kontext } from './kontext.js';
import { formFelder, seite, seitenKopf } from './views/layout.js';
import { datumZeit } from './views/teile.js';
import { setzeWartung } from './wartung.js';

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
    case 'datum':
      eingabe = html`<span class="knopfreihe"><input id="${id}" name="${id}" type="date" value="${wert}">${
        d.schluessel === 'ENTRA_SECRET_ABLAUF' ? plusZweiJahreKnopf(id) : ''}</span>`;
      break;
    case 'url':
      eingabe = html`<input id="${id}" name="${id}" type="url" maxlength="1000" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
      break;
    default:
      eingabe = html`<input id="${id}" name="${id}" maxlength="1000" value="${wert}"${d.pflicht ? new Roh(' required') : ''}>`;
  }
  return html`<div class="feld">${kopf}${eingabe}${hilfe}</div>`;
}

/** Knopf «Heute + 2 Jahre» (Wunsch Yann 23.11.2026). app.js setzt das Datum ins Feld. Der Server rechnet es aus. */
function plusZweiJahreKnopf(ziel: string): Roh {
  return html`<button type="button" class="knopf" data-datum-setzen="${inZweiJahren()}" data-datum-ziel="${ziel}">Heute + 2 Jahre</button>`;
}

/** Reiter der Seite Admin › Einstellungen (Wunsch Yann 20.11.2026, wie die Reiter im Einsatz). */
export type EinstellungReiter = 'stammdaten' | 'vorlagen' | 'mail' | 'login' | 'clubdesk' | 'server' | 'protokoll';

const REITER: { id: EinstellungReiter; text: string; href: string; gruppen?: string[] }[] = [
  { id: 'stammdaten', text: 'Stammdaten', href: '/admin/einstellungen' },
  { id: 'vorlagen', text: 'Vorlagen', href: '/admin/einstellungen/vorlagen' },
  { id: 'mail', text: 'Mail', href: '/admin/einstellungen/mail', gruppen: ['Mail'] },
  { id: 'login', text: 'Login', href: '/admin/einstellungen/login', gruppen: ['Login mit Microsoft Entra'] },
  { id: 'clubdesk', text: 'Clubdesk und Export', href: '/admin/einstellungen/clubdesk', gruppen: ['Clubdesk', 'Tagesexport und SharePoint'] },
  { id: 'server', text: 'Server', href: '/admin/einstellungen/server', gruppen: ['Server', 'Datenbank', 'Ordner', 'Update'] },
  { id: 'protokoll', text: 'Protokoll', href: '/admin/einstellungen/protokoll' },
];

export function reiterPfad(r: EinstellungReiter): string {
  return REITER.find((x) => x.id === r)!.href;
}

function istKonfigReiter(r: unknown): r is EinstellungReiter {
  return REITER.some((x) => x.id === r && x.gruppen);
}

/** Ohne Angabe: der Reiter des ersten Felds im Formular. */
function reiterAusFeldern(eingaben: Record<string, unknown>): EinstellungReiter {
  const feld = Object.keys(eingaben).find((x) => x.startsWith('w_'));
  const gruppe = feld ? DEFINITIONEN.find((d) => `w_${d.schluessel}` === feld)?.gruppe : undefined;
  return REITER.find((r) => gruppe && r.gruppen?.includes(gruppe))?.id ?? 'server';
}

const quellen = new WeakMap<Abhaengigkeiten, Quelle>();

/** Datei und Startwerte. Ohne Angabe gilt der Stand beim ersten Aufruf als «laufend». */
export function quelleVon(deps: Abhaengigkeiten): Quelle {
  if (deps.konfigQuelle) return deps.konfigQuelle;
  let q = quellen.get(deps);
  if (!q) {
    q = erstelleQuelle(envDateiPfad(), process.env, ausUmgebung);
    quellen.set(deps, q);
  }
  return q;
}

/** Stand des Entra-Schlüssels nach den Werten in der Datei (Umgebungsvariablen haben Vorrang). */
export function entraAblaufVon(deps: Abhaengigkeiten): EntraAblauf {
  return entraAblauf(kuenftigeWerte(quelleVon(deps)));
}

export const ANLEITUNG_ENTRA = '/admin/einstellungen/login/entra-schluessel';

/**
 * Warnung ab 30 Tagen vor dem Ablauf, mit Knopf zur Anleitung (Wunsch Yann 23.11.2026).
 * Ohne Ablaufdatum: nur mit «auchOhneDatum» (Reiter Login).
 */
export function entraWarnung(a: EntraAblauf, auchOhneDatum = false): Roh | '' {
  if (a.stufe === 'ohne_login' || (a.stufe === 'fehlt' && !auchOhneDatum)) return '';
  if (a.stufe === 'ok') {
    return auchOhneDatum ? html`<div class="meldung ok entra-warnung">Der Entra-Schlüssel gilt bis ${datumCh(a.datum)} (noch ${a.tage} Tage).
      <a href="${ANLEITUNG_ENTRA}">Anleitung zum Erneuern</a></div>` : '';
  }
  const klasse = a.stufe === 'abgelaufen' ? 'fehler' : 'hinweis';
  return html`<div class="meldung ${klasse} entra-warnung" role="${a.stufe === 'abgelaufen' ? 'alert' : 'status'}">
  <span>${ablaufText(a, datumCh)}${a.stufe === 'fehlt' ? ' Trage es ein. Dann warnt das Cockpit 30 Tage vorher.' : ''}</span>
  <a class="knopf${a.stufe === 'fehlt' ? '' : ' haupt'}" href="${ANLEITUNG_ENTRA}">Anleitung zum Erneuern</a>
</div>`;
}

/** Rahmen aller Reiter: Kopf mit Reitern, Hinweis «Neustart nötig», Inhalt. */
export function einstellungenSeite(deps: Abhaengigkeiten, kx: Kontext, aktiv: EinstellungReiter, inhalt: Roh): string {
  const neustart = zeilen(quelleVon(deps)).zeilen.some((x) => x.neustartNoetig);
  const titel = REITER.find((x) => x.id === aktiv)!.text;
  return seite(kx, `Einstellungen · ${titel}`, 'einstellungen', html`
${seitenKopf({ titel: 'Einstellungen', reiter: REITER.map((r) => ({ text: r.text, href: r.href, aktiv: r.id === aktiv })) })}
${neustart ? html`<div class="meldung hinweis">Einige Werte sind gespeichert, aber noch nicht aktiv. <a href="${reiterPfad('server')}#neustart">Starte den Server neu.</a></div>` : ''}
${inhalt}`);
}

/** Reiter mit Werten aus einsatzplaner.env: nur die Gruppen dieses Reiters. */
function konfigReiter(deps: Abhaengigkeiten, kx: Kontext, reiter: EinstellungReiter, z: Zustand = {}): string {
  const q = quelleVon(deps);
  const stand = zeilen(q);
  const r = REITER.find((x) => x.id === reiter)!;
  return einstellungenSeite(deps, kx, reiter, html`
<p class="unter">Diese Werte stehen in der Datei <code>${q.pfad}</code>. Änderungen wirken erst nach einem Neustart des Servers. Passwörter und Schlüssel zeigt die Seite nie an. Ein leeres Feld lässt den Wert unverändert.</p>
${reiter === 'login' ? entraWarnung(entraAblaufVon(deps), true) : ''}
${z.fehler ? html`<div class="meldung fehler" role="alert">${z.fehler}</div>` : ''}
<form method="post" action="${PFAD}" class="stapel">
  ${formFelder(kx, r.href)}
  <input type="hidden" name="reiter" value="${reiter}">
  <input type="hidden" name="version" value="${z.version ?? stand.version}">
  ${r.gruppen!.map((g) => html`<section class="abschnitt"><h2>${g}</h2>${stand.zeilen.filter((x) => x.d.gruppe === g).map((x) => feld(x, z.eingaben))}</section>`)}
  ${z.dbFehler ? html`<label class="haken wichtig"><input type="checkbox" name="trotzdem" value="1"> Trotzdem speichern. Nach dem Neustart startet der Server vermutlich nicht.</label>` : ''}
  <div class="knopfreihe"><button type="submit" class="knopf haupt">Speichern</button></div>
</form>
${reiter === 'mail' ? html`<section class="abschnitt" id="smtp">
  <h2>SMTP testen</h2>
  <p>Das Tool sendet eine Testmail mit den gespeicherten Werten. Speichere neue Werte zuerst.</p>
  <form method="post" action="${PFAD}/smtp-test" class="zeilen-form">${formFelder(kx)}
    <input name="an" type="email" required maxlength="200" value="${kx.benutzer!.email ?? ''}" aria-label="Empfänger">
    <button type="submit" class="knopf">Testmail senden</button></form>
</section>` : ''}
${reiter === 'server' ? html`<section class="abschnitt" id="neustart">
  <h2>Server neu starten</h2>
  ${deps.neustart
    ? html`<p>Der Server beendet sich. Das Startskript startet ihn nach 3 Sekunden neu. Die Seiten anderer Benutzer sind bis zum Neustart gesperrt. Ihre offenen Eingaben bleiben erhalten.</p>
  <form method="post" action="${PFAD}/neustart" class="stapel" data-normal>${formFelder(kx)}
    <label class="haken wichtig"><input type="checkbox" name="bestaetigt" value="1" required> Server jetzt neu starten.</label>
    <button type="submit" class="knopf">Neu starten</button></form>`
    : html`<p class="unter">Ein Neustart über diese Seite ist hier nicht möglich.</p>`}
</section>` : ''}`);
}

/** Link direkt zu «Zertifikate und Geheimnisse» der App im Entra Admin Center. Nur mit einer gültigen Client-ID. */
function entraLink(clientId: string): string {
  return /^[0-9a-fA-F-]{36}$/.test(clientId)
    ? `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/${clientId}`
    : 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade';
}

/** Anleitung: Entra-Schlüssel erneuern und den neuen Wert direkt hier eintragen (Wunsch Yann 23.11.2026). */
function anleitungEntra(deps: Abhaengigkeiten, kx: Kontext): string {
  const q = quelleVon(deps);
  const stand = zeilen(q);
  const w = kuenftigeWerte(q);
  const geheim = stand.zeilen.find((x) => x.d.schluessel === 'ENTRA_CLIENT_SECRET')!;
  const ablauf = stand.zeilen.find((x) => x.d.schluessel === 'ENTRA_SECRET_ABLAUF')!;
  const gesperrt = geheim.gesperrt || ablauf.gesperrt;
  return einstellungenSeite(deps, kx, 'login', html`
${entraWarnung(entraAblaufVon(deps), true)}
<section class="abschnitt">
  <h2>Entra-Schlüssel erneuern</h2>
  <p>Der Login braucht einen geheimen Clientschlüssel aus Microsoft Entra. Er gilt höchstens 2 Jahre. Erneuere ihn vor dem Ablauf. Du brauchst dazu keinen Zugang zum Server.</p>
  <ol class="schritte anleitung">
    <li>Öffne das <a href="${entraLink(w.ENTRA_CLIENT_ID)}" target="_blank" rel="noopener noreferrer">Microsoft Entra Admin Center</a> und melde dich mit einem Admin-Konto an. Du brauchst die Rolle «Anwendungsadministrator» oder höher.</li>
    <li>Wähle <strong>Entra ID › App-Registrierungen › Alle Anwendungen</strong>. Öffne die App mit der Anwendungs-ID <code>${w.ENTRA_CLIENT_ID || '(nicht gesetzt)'}</code>. Der Link oben öffnet sie meist direkt.</li>
    <li>Wähle links <strong>Zertifikate und Geheimnisse</strong>, dann den Reiter <strong>Geheime Clientschlüssel</strong>.</li>
    <li>Klicke <strong>Neuer geheimer Clientschlüssel</strong>. Schreibe als Beschreibung z. B. «Einsatzplaner ${inZweiJahren().slice(0, 4)}». Wähle als Ablauf <strong>24 Monate</strong>. Klicke <strong>Hinzufügen</strong>.</li>
    <li>Kopiere sofort die Spalte <strong>Wert</strong>, nicht die «Geheime ID». Entra zeigt den Wert nur jetzt. Später ist er verborgen.</li>
    <li>Füge den Wert unten ein. Setze das Ablaufdatum aus der Spalte <strong>Läuft ab</strong>. Bei 24 Monaten hilft der Knopf «Heute + 2 Jahre».</li>
    <li>Klicke <strong>Speichern</strong>. Mit dem Häkchen startet der Server danach neu. Erst dann gilt der neue Schlüssel.</li>
    <li>Melde dich ab und wieder an. So prüfst du den neuen Schlüssel.</li>
    <li>Lösche den alten Schlüssel in Entra erst nach dieser Prüfung (Papierkorb-Symbol in seiner Zeile). Bis dahin funktionieren beide.</li>
  </ol>
  <p class="unter warn-text">Ein falscher Wert sperrt nach dem Neustart den Login. Lösche darum den alten Schlüssel in Entra nicht vorher. Der alte Stand der Datei bleibt als <code>${q.pfad}.vorher</code>.</p>
</section>
<section class="abschnitt" id="eintragen">
  <h2>Neuen Schlüssel eintragen</h2>
  ${gesperrt
    ? html`<p class="unter">Schlüssel oder Ablaufdatum kommen aus einer Umgebungsvariablen. Du kannst sie nur auf dem Server ändern.</p>`
    : html`<form method="post" action="${PFAD}" class="stapel" data-normal>
    ${formFelder(kx, reiterPfad('login'))}
    <input type="hidden" name="reiter" value="login">
    <input type="hidden" name="version" value="${stand.version}">
    <div class="feld"><label for="w_ENTRA_CLIENT_SECRET">Wert des neuen Schlüssels</label>
      <input id="w_ENTRA_CLIENT_SECRET" name="w_ENTRA_CLIENT_SECRET" type="password" autocomplete="new-password" required maxlength="1000">
      <p class="unter">Das Tool speichert den Wert in <code>${q.pfad}</code> und zeigt ihn nie wieder an.</p></div>
    <div class="feld"><label for="w_ENTRA_SECRET_ABLAUF">Ablaufdatum (Spalte «Läuft ab»)</label>
      <span class="knopfreihe"><input id="w_ENTRA_SECRET_ABLAUF" name="w_ENTRA_SECRET_ABLAUF" type="date" required value="${ablauf.wert}">${plusZweiJahreKnopf('w_ENTRA_SECRET_ABLAUF')}</span></div>
    ${deps.neustart ? html`<label class="haken"><input type="checkbox" name="neustart" value="1" checked> Server danach neu starten. Die Seiten anderer Benutzer sind kurz gesperrt.</label>` : ''}
    <div class="knopfreihe"><button type="submit" class="knopf haupt">Speichern</button></div>
  </form>`}
</section>`);
}

async function protokollReiter(deps: Abhaengigkeiten, kx: Kontext): Promise<string> {
  const protokoll = await letzteKonfigAenderungen(deps.db);
  return einstellungenSeite(deps, kx, 'protokoll', html`
<p class="unter">Wer hat wann welchen Wert oder welche Vorlage geändert. Geheimnisse stehen hier nur als «(gesetzt)» oder «(leer)».</p>
${protokoll.length
    ? html`<div class="rahmen"><table class="tabelle"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Wert</th><th>Alt</th><th>Neu</th></tr></thead><tbody>
    ${protokoll.map((p) => html`<tr><td>${datumZeit(p.zeit)}</td><td>${p.benutzer ?? ''}</td><td><code>${p.schluessel}</code></td><td>${p.alt || '–'}</td><td>${p.neu || '–'}</td></tr>`)}
    </tbody></table></div>`
    : html`<p class="unter">Noch keine Änderung.</p>`}`);
}

export function registriereKonfiguration(app: Express, deps: Abhaengigkeiten): void {
  const q = () => quelleVon(deps);

  // Alte Adresse: Die Werte stehen jetzt in den Reitern von Admin › Einstellungen.
  app.get(PFAD, nurAdmin, (_req, res) => res.redirect(302, reiterPfad('server')));
  for (const r of REITER) {
    if (!r.gruppen) continue;
    app.get(r.href, nurAdmin, (_req, res) => {
      res.send(konfigReiter(deps, k(res), r.id));
    });
  }
  app.get(reiterPfad('protokoll'), nurAdmin, async (_req, res) => {
    res.send(await protokollReiter(deps, k(res)));
  });

  app.post(PFAD, nurAdmin, async (req: Request, res: Response) => {
    const kx = k(res);
    const eingaben = (req.body ?? {}) as Record<string, unknown>;
    const reiter: EinstellungReiter = istKonfigReiter(eingaben.reiter) ? eingaben.reiter : reiterAusFeldern(eingaben);
    try {
      const aenderungen = await speichereKonfiguration(deps.db, q(), eingaben, kx.benutzer!.id, {
        testeDatenbank: testeVerbindung,
        trotzdem: eingaben.trotzdem === '1',
      });
      if (aenderungen.length) log('info', `Konfiguration geändert von ${kx.benutzer!.name}: ${aenderungen.map((a) => a.schluessel).join(', ')}.`);
      const mitNeustart = aenderungen.some((a) => !DEFINITIONEN.find((d) => d.schluessel === a.schluessel)?.sofort);
      // Neuer Entra-Schlüssel über die Anleitung: auf Wunsch gleich neu starten.
      if (mitNeustart && eingaben.neustart === '1' && deps.neustart) {
        starteNeu(res, reiterPfad(reiter), `Gespeichert: ${aenderungen.length} Wert${aenderungen.length === 1 ? '' : 'e'}. `);
        return;
      }
      const text = `Gespeichert: ${aenderungen.length} Wert${aenderungen.length === 1 ? '' : 'e'}.`;
      zurueck(req, res, reiterPfad(reiter), aenderungen.length
        ? mitNeustart ? `${text} Die Änderung wirkt nach einem Neustart.` : text
        : 'Keine Änderung.');
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      // Die Eingaben bleiben stehen. Nach einem Konflikt überschreibt ein zweites Speichern bewusst.
      const konflikt = e instanceof KonfigKonflikt;
      res.status(konflikt ? 409 : 400).send(konfigReiter(deps, kx, reiter, {
        eingaben,
        fehler: `${e.message}${konflikt ? '' : ' Gib Passwörter und Schlüssel erneut ein.'}`,
        version: konflikt ? e.aktuelleVersion : typeof eingaben.version === 'string' ? eingaben.version : undefined,
        dbFehler: e instanceof DatenbankNichtErreichbar,
      }));
    }
  });

  /** Antwort «Der Server startet neu» und Neustart nach 300 ms. */
  const starteNeu = (res: Response, ziel: string, vorher = '') => {
    const neustart = deps.neustart!;
    log('info', `Neustart über Admin › Einstellungen durch ${k(res).benutzer!.name}.`);
    // Die Seite lädt sich nach 10 Sekunden selbst neu (Header «Refresh», kein Skript nötig).
    res.setHeader('Refresh', `10; url=${ziel}`);
    res.send(seite(k(res), 'Neustart', 'einstellungen', html`${seitenKopf({ titel: 'Neustart' })}<p class="meldung hinweis">${vorher}Der Server startet neu. Die Seite lädt sich in 10 Sekunden neu.</p>`));
    // Alle anderen Seiten zeigen bis zum Neustart das Fenster «Bitte warten» und laden danach neu.
    setzeWartung('neustart');
    setTimeout(() => neustart(), 300).unref();
  };

  app.get(ANLEITUNG_ENTRA, nurAdmin, (_req, res) => {
    res.send(anleitungEntra(deps, k(res)));
  });

  app.post(`${PFAD}/neustart`, nurAdmin, (req, res) => {
    if (!deps.neustart) throw new Eingabefehler('Ein Neustart über diese Seite ist hier nicht möglich.');
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige den Neustart mit dem Häkchen.');
    starteNeu(res, reiterPfad('server'));
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
      zurueck(req, res, `${reiterPfad('mail')}#smtp`, `Testmail an ${an} gesendet.`);
    } catch (e) {
      zurueck(req, res, `${reiterPfad('mail')}#smtp`, `Testmail nicht gesendet: ${(e as Error).message}`, 'fehler');
    } finally {
      transport.close();
    }
  });
}
