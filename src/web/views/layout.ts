// Seitenrahmen: Navigation links, Inhalt rechts. Jede Seite ist gleich aufgebaut:
// oben Pfad, Titel und rechts der wichtigste Knopf, darunter Reiter, dann der Inhalt.
import { html, Roh, wenn } from '../html.js';
import type { Kontext } from '../kontext.js';
import { symbol, type SymbolName } from './symbole.js';
import { aenderungsStand } from '../../db/aenderungen.js';

export type Bereich =
  | 'start' | 'einsaetze' | 'rueckmeldungen' | 'personen' | 'unbekannt' | 'archiv'
  | 'import' | 'export' | 'benutzer' | 'einstellungen' | 'konfiguration' | 'update';

/** Ändert sich bei jedem Start. So lädt der Browser nach einem Update das neue CSS und Skript. */
const VERSION = Date.now().toString(36);

function link(bereich: Bereich, aktiv: Bereich | null, href: string, text: string, icon: SymbolName, zaehler?: number): Roh {
  return html`<li><a href="${href}"${wenn(bereich === aktiv, new Roh(' aria-current="page" class="aktiv"'))}>
    ${symbol(icon)}<span class="text">${text}</span>${zaehler ? html`<span class="zaehler" title="offen">${zaehler}</span>` : ''}</a></li>`;
}

/** Initialen für das Benutzer-Symbol unten links. */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  const z = teile.length > 1 ? teile[0][0] + teile[teile.length - 1][0] : (teile[0] ?? '?').slice(0, 2);
  return z.toUpperCase();
}


function kopfDaten(titel: string): Roh {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titel}</title>
<script src="/static/thema.js?v=${VERSION}"></script>
<link rel="icon" type="image/png" href="/static/favicon.png?v=${VERSION}">
<link rel="stylesheet" href="/static/style.css?v=${VERSION}">
<script src="/static/app.js?v=${VERSION}" defer></script>`;
}

/**
 * Seite mit Navigation. Die Seite aktualisiert sich live (data-live-nr, siehe app.js).
 * ohneLive: Die Seite lädt normal neu, z. B. Admin › Update mit dem Header «Refresh».
 * fest: Die Seite selbst scrollt nicht, nur ihre Tabelle (z. B. Rückmeldungen). Gilt nicht auf dem Handy.
 */
export function seite(k: Kontext, titel: string, aktiv: Bereich | null, inhalt: Roh, extra: { breit?: boolean; ohneLive?: boolean; fest?: boolean } = {}): string {
  const b = k.benutzer!;
  const istAdmin = b.rolle === 'admin';
  return `<!doctype html>${html`<html lang="de">
<head>
${kopfDaten(`${titel} · Einsatzplaner`)}
</head>
<body class="mit-leiste" data-live-nr="${aenderungsStand()}"${extra.ohneLive ? new Roh(' data-ohne-live') : ''}>
<header class="kopf-mobil">
  <button type="button" class="knopf-menue" aria-controls="leiste" aria-expanded="false" aria-label="Menü öffnen">${symbol('menue')}</button>
  <span class="marke-klein">Einsatzplaner</span>
</header>
<nav id="leiste" class="leiste" aria-label="Hauptmenü">
  <a class="marke" href="/">
    <img class="marke-zeichen" src="/static/logo.png?v=${VERSION}" alt="" width="32" height="32">
    <span class="marke-text">Einsatzplaner<small>Kadetten-Korps Basel</small></span>
  </a>
  <ul>
    ${link('start', aktiv, '/', 'Cockpit', 'cockpit', k.zaehler.unbestaetigt)}
    ${link('einsaetze', aktiv, '/einsaetze', 'Einsätze', 'kalender')}
    ${link('rueckmeldungen', aktiv, '/rueckmeldungen', 'Rückmeldungen', 'posteingang')}
    ${link('unbekannt', aktiv, '/anmeldungen/unbekannt', 'Unbekannte', 'frage', k.zaehler.unbekannt)}
    ${link('personen', aktiv, '/personen', 'Personen', 'personen')}
    ${link('archiv', aktiv, '/einsaetze?ansicht=archiv', 'Archiv', 'archiv')}
  </ul>
  ${wenn(istAdmin, html`<div class="leiste-titel">Admin</div>
  <ul>
    ${link('import', aktiv, '/admin/import', 'Import', 'import')}
    ${link('export', aktiv, '/admin/export', 'Export', 'export')}
    ${link('benutzer', aktiv, '/admin/benutzer', 'Benutzer', 'benutzer')}
    ${link('einstellungen', aktiv, '/admin/einstellungen', 'Einstellungen', 'zahnrad')}
    ${link('konfiguration', aktiv, '/admin/konfiguration', 'Konfiguration', 'datei')}
    ${link('update', aktiv, '/admin/update', 'Update', 'update')}
  </ul>`)}
  <div class="leiste-fuss">
    <span class="avatar" aria-hidden="true">${initialen(b.name)}</span>
    <span class="benutzer"><span class="benutzer-name">${b.name}</span><small>${istAdmin ? 'Admin' : 'Aufgebotsstelle'}</small></span>
    <span class="fuss-aktionen">
      <button type="button" class="thema-knopf" data-thema title="Darstellung: wie System" aria-label="Darstellung wechseln">${symbol('bildschirm', 'thema-system')}${symbol('sonne', 'thema-hell')}${symbol('mond', 'thema-dunkel')}</button>
      <form method="post" action="/logout" data-normal>
        <input type="hidden" name="_csrf" value="${k.csrf}">
        <button type="submit" class="link-knopf">Abmelden</button>
      </form>
    </span>
  </div>
</nav>
<main class="inhalt${extra.breit ? ' breit' : ''}${extra.fest ? ' fest' : ''}">
  ${k.meldung ? toast(k.meldung.art, k.meldung.text, k.meldung.rueckgaengig ? rueckgaengigKnopf(k, k.meldung.rueckgaengig) : undefined) : ''}
  ${inhalt}
</main>
</body>
</html>`}`;
}

/**
 * Kurze Meldung nach einer Aktion («Gespeichert»). Sie erscheint unten rechts über dem Inhalt
 * und verschiebt nichts. Das Skript sammelt sie in einem Stapel und blendet sie aus:
 * ok nach 3 Sekunden, Hinweis nach 6 Sekunden. Ein Fehler bleibt, bis man ihn schliesst.
 */
export function toast(art: 'ok' | 'fehler' | 'hinweis', text: string, aktion?: Roh): Roh {
  const zeichen = art === 'ok' ? '✓' : art === 'fehler' ? '!' : 'i';
  return html`<div class="toast ${art}" role="${art === 'fehler' ? 'alert' : 'status'}" data-toast="${art}"${aktion ? html` data-toast-aktion` : ''}>
    <span class="toast-zeichen" aria-hidden="true">${zeichen}</span><span class="toast-text">${text}</span>${aktion ?? ''}
    <button type="button" class="toast-zu" data-toast-zu aria-label="Meldung schliessen">×</button>
  </div>`;
}

/**
 * Knopf «Rückgängig» im Toast. Er sendet den Schlüssel der letzten Aktion.
 * Der Toast bleibt dann 10 Sekunden. Der Server nimmt den Schlüssel 10 Minuten lang an.
 */
function rueckgaengigKnopf(k: Kontext, schluessel: string): Roh {
  return html`<form method="post" action="/rueckgaengig" class="toast-form">
      ${formFelder(k, k.pfad)}
      <input type="hidden" name="schluessel" value="${schluessel}">
      <button type="submit" class="toast-rueckgaengig">Rückgängig</button>
    </form>`;
}

/** Druckansicht ohne Seitenleiste. */
export function druckseite(titel: string, inhalt: Roh, klasse = ''): string {
  return `<!doctype html>${html`<html lang="de">
<head>
${kopfDaten(titel)}
</head>
<body class="druck ${klasse}">
${inhalt}
</body>
</html>`}`;
}

/** Einfache Seite ohne Login (Fehler, Kein Zugriff, Test-Login). */
export function einfacheSeite(titel: string, inhalt: Roh): string {
  return `<!doctype html>${html`<html lang="de">
<head>
${kopfDaten(`${titel} · Einsatzplaner`)}
</head>
<body class="einfach">
<main class="inhalt schmal">
  <div class="marke einfach-marke"><img class="marke-zeichen" src="/static/logo.png?v=${VERSION}" alt="" width="32" height="32"><span class="marke-text">Einsatzplaner<small>Kadetten-Korps Basel</small></span></div>
  <div class="karte">${inhalt}</div>
</main>
</body>
</html>`}`;
}

/** Verstecktes CSRF-Feld und Rücksprung-Ziel für Formulare. */
export function formFelder(k: Kontext, zurueck?: string): Roh {
  return html`<input type="hidden" name="_csrf" value="${k.csrf}">${zurueck ? html`<input type="hidden" name="zurueck" value="${zurueck}">` : ''}`;
}

// ---------- Seitenkopf ----------

export interface PfadTeil {
  text: string;
  href?: string;
}

export interface Reiter {
  text: string;
  href: string;
  aktiv?: boolean;
  zahl?: number;
}

export interface Kopf {
  /** Kleine Zeile über dem Titel, z. B. das Datum. */
  ueber?: string;
  pfad?: PfadTeil[];
  titel: Roh | string;
  /** Marke direkt neben dem Titel, z. B. «Publiziert». */
  marke?: Roh;
  /** Angaben unter dem Titel. */
  angaben?: (Roh | string)[];
  /** Knöpfe rechts. Der erste ist der wichtigste. */
  aktionen?: Roh;
  /** Anzeige «Live». Standard: an. false bei Seiten ohne Live-Aktualisierung. */
  live?: boolean;
  reiter?: Reiter[];
}

/** Kopf jeder Seite: Pfad, Titel, Angaben, rechts Live-Anzeige und Knöpfe, darunter Reiter. */
export function seitenKopf(k: Kopf): Roh {
  return html`<header class="seitenkopf">
  <div class="seitenkopf-zeile">
    <div class="seitenkopf-titel">
      ${k.pfad?.length ? html`<nav class="pfad" aria-label="Pfad">${k.pfad.map((p, i) => html`${i > 0 ? html`<span class="trenner" aria-hidden="true">›</span>` : ''}${p.href ? html`<a href="${p.href}">${p.text}</a>` : html`<span>${p.text}</span>`}`)}</nav>` : ''}
      ${k.ueber ? html`<p class="ueber">${k.ueber}</p>` : ''}
      <h1>${k.titel}${k.marke ? html` ${k.marke}` : ''}</h1>
      ${k.angaben?.length ? html`<p class="angaben">${k.angaben.filter((a) => a !== '').map((a) => html`<span>${a}</span>`)}</p>` : ''}
    </div>
    ${k.live !== false || k.aktionen ? html`<div class="seitenkopf-aktionen">
      ${k.live !== false ? html`<span class="live" data-live title="Die Seite zeigt Änderungen aller Benutzer sofort an."><span class="live-punkt" aria-hidden="true"></span><span class="live-text">Live</span></span>` : ''}
      ${k.aktionen ?? ''}
    </div>` : ''}
  </div>
  ${k.reiter?.length ? html`<nav class="reiter" aria-label="Reiter">${k.reiter.map((r) => html`<a href="${r.href}"${r.aktiv ? new Roh(' aria-current="page"') : ''}>${r.text}${r.zahl !== undefined ? html`<span class="reiter-zahl">${r.zahl}</span>` : ''}</a>`)}</nav>` : ''}
</header>`;
}

/** Menü «Mehr ▾» mit selten gebrauchten Aktionen. Funktioniert ohne Skript. */
export function mehrMenue(eintraege: Roh[], text = 'Mehr'): Roh {
  return html`<details class="menue">
  <summary class="knopf">${text} <span aria-hidden="true">▾</span></summary>
  <div class="menue-liste">${eintraege}</div>
</details>`;
}
