// Seitenrahmen mit Seitenleiste (Abschnitt 3 des Auftrags).
import { html, Roh, wenn } from '../html.js';
import type { Kontext } from '../kontext.js';

export type Bereich =
  | 'start' | 'einsaetze' | 'rueckmeldungen' | 'personen' | 'unbekannt' | 'archiv'
  | 'import' | 'export' | 'benutzer' | 'einstellungen' | 'konfiguration' | 'update';

function link(k: Kontext, bereich: Bereich, aktiv: Bereich | null, href: string, text: string, zaehler?: number): Roh {
  return html`<li><a href="${href}"${wenn(bereich === aktiv, new Roh(' aria-current="page" class="aktiv"'))}>
    <span>${text}</span>${zaehler ? html`<span class="zaehler" title="offen">${zaehler}</span>` : ''}</a></li>`;
}

/** Datenstand der Seite. Das Skript fragt url regelmässig ab und meldet eine Änderung. */
export interface SeitenStand {
  url: string;
  wert: string;
}

export function seite(k: Kontext, titel: string, aktiv: Bereich | null, inhalt: Roh, extra: { breit?: boolean; stand?: SeitenStand } = {}): string {
  const b = k.benutzer!;
  const istAdmin = b.rolle === 'admin';
  return `<!doctype html>${html`<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titel} · Einsatzplaner</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
</head>
<body class="mit-leiste">
<header class="kopf-mobil">
  <span class="marke">Einsatzplaner</span>
  <button type="button" class="knopf-menue" aria-controls="leiste" aria-expanded="false">Menü</button>
</header>
<nav id="leiste" class="leiste" aria-label="Hauptmenü">
  <div class="marke">Einsatzplaner<small>Verkehrskadetten KKB</small></div>
  <ul>
    ${link(k, 'start', aktiv, '/', 'Start', k.zaehler.unbestaetigt)}
    ${link(k, 'einsaetze', aktiv, '/einsaetze', 'Einsätze')}
    ${link(k, 'rueckmeldungen', aktiv, '/rueckmeldungen', 'Rückmeldungen')}
    ${link(k, 'personen', aktiv, '/personen', 'Personen')}
    ${link(k, 'unbekannt', aktiv, '/anmeldungen/unbekannt', 'Unbekannte', k.zaehler.unbekannt)}
    ${link(k, 'archiv', aktiv, '/einsaetze?ansicht=archiv', 'Archiv')}
  </ul>
  ${wenn(istAdmin, html`<div class="leiste-titel">Admin</div>
  <ul>
    ${link(k, 'import', aktiv, '/admin/import', 'Import')}
    ${link(k, 'export', aktiv, '/admin/export', 'Export')}
    ${link(k, 'benutzer', aktiv, '/admin/benutzer', 'Benutzer')}
    ${link(k, 'einstellungen', aktiv, '/admin/einstellungen', 'Einstellungen')}
    ${link(k, 'konfiguration', aktiv, '/admin/konfiguration', 'Konfiguration')}
    ${link(k, 'update', aktiv, '/admin/update', 'Update')}
  </ul>`)}
  <div class="leiste-fuss">
    <span class="benutzer-name">${b.name}</span>
    <form method="post" action="/logout">
      <input type="hidden" name="_csrf" value="${k.csrf}">
      <button type="submit" class="link-knopf">Abmelden</button>
    </form>
  </div>
</nav>
<main class="inhalt${extra.breit ? ' breit' : ''}">
  ${extra.stand ? html`<div class="meldung hinweis datenstand" role="status" hidden data-stand-url="${extra.stand.url}" data-stand="${extra.stand.wert}">
    <span>Ein anderer Benutzer hat Daten auf dieser Seite geändert. Lade die Seite neu, um den neuen Stand zu sehen.</span>
    <button type="button" class="knopf haupt klein" data-neu-laden>Neu laden</button>
  </div>` : ''}
  ${k.meldung ? html`<div class="meldung ${k.meldung.art}" role="status" data-verschwinden="${k.meldung.art === 'ok' ? '1' : ''}">${k.meldung.text}</div>` : ''}
  ${inhalt}
</main>
</body>
</html>`}`;
}

/** Druckansicht ohne Seitenleiste. */
export function druckseite(titel: string, inhalt: Roh, klasse = ''): string {
  return `<!doctype html>${html`<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titel}</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
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
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titel} · Einsatzplaner</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="einfach">
<main class="inhalt schmal">${inhalt}</main>
</body>
</html>`}`;
}

/** Verstecktes CSRF-Feld und Rücksprung-Ziel für Formulare. */
export function formFelder(k: Kontext, zurueck?: string): Roh {
  return html`<input type="hidden" name="_csrf" value="${k.csrf}">${zurueck ? html`<input type="hidden" name="zurueck" value="${zurueck}">` : ''}`;
}
