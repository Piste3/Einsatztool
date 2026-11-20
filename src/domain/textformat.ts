// Einfache Formatierung für den Clubdesk-Text (Wunsch Yann 20.11.2026).
// Der Clubdesk-Editor übernimmt Fett, Farbe, Titel und Tabellen beim Einfügen als HTML.
// Darum schreibt der Admin eine kleine Auszeichnung statt HTML. Das Tool erzeugt daraus HTML und reinen Text.
//
//   **fett**             fett
//   [rot]Text[/rot]      farbig (rot, blau, gruen, orange)
//   # Titel              Zwischentitel (eigene Zeile)
//   | A | B |            Tabellenzeile. Folgende Zeilen mit | bilden eine Tabelle.
//   \\                   neue Zeile innerhalb einer Zeile oder Zelle
//   Leerzeile            neuer Absatz
//
// Alles andere bleibt Text. Das Tool maskiert jeden Text. Eigenes HTML geht nicht.

/** Farben mit Wert für den Clubdesk-Editor. Die Klasse zeigt die Farbe in der eigenen Vorschau (CSP ohne Inline-Styles). */
export const FARBEN: Record<string, string> = {
  rot: '#e00000',
  blau: '#0055cc',
  gruen: '#008a00',
  orange: '#e07000',
};

export const AUSZEICHNUNG: [string, string][] = [
  ['**fett**', 'Fett'],
  ['[rot]Text[/rot]', 'Farbe: rot, blau, gruen, orange'],
  ['# Titel', 'Zwischentitel (am Anfang der Zeile)'],
  ['| **A** | B |', 'Tabellenzeile, mehrere Zeilen ergeben eine Tabelle'],
  ['\\\\', 'Neue Zeile in einer Zeile oder Zelle'],
  ['Leerzeile', 'Neuer Absatz'],
];

function maskiere(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FARB_MUSTER = new RegExp(`\\[(${Object.keys(FARBEN).join('|')})\\]([\\s\\S]*?)\\[\\/\\1\\]`, 'g');

/** Auszeichnung in einer Zeile oder Zelle als HTML. */
function inlineHtml(t: string): string {
  let h = maskiere(t);
  h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(FARB_MUSTER, (_g, f: string, inhalt: string) => `<span class="text-${f}" style="color:${FARBEN[f]}">${inhalt}</span>`);
  return h.replace(/\s*\\\\\s*/g, '<br>');
}

/** Auszeichnung in einer Zeile oder Zelle als reiner Text. */
function inlineText(t: string): string {
  return t
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(FARB_MUSTER, '$2')
    .replace(/\s*\\\\\s*/g, '\n');
}

/** Zellen einer Tabellenzeile. Ein Umbruch \\ am Anfang oder Ende einer Zelle entfällt (leerer Baustein). */
function zellen(zeile: string): string[] {
  return zeile
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((z) => z.trim().replace(/^(\\\\\s*)+|(\s*\\\\)+$/g, '').trim());
}

type Block = { art: 'leer' } | { art: 'absatz'; zeilen: string[] } | { art: 'titel'; text: string } | { art: 'tabelle'; zeilen: string[][] };

function bloecke(text: string): Block[] {
  const ergebnis: Block[] = [];
  let aktuell: Block | null = null;
  for (const roh of text.replace(/\r\n?/g, '\n').split('\n')) {
    const zeile = roh.replace(/\s+$/, '');
    if (!zeile.trim()) {
      // Eine Leerzeile wird ein leerer Absatz. Grund: Der Editor von Clubdesk zeigt Absätze ohne Abstand.
      if (ergebnis.length && ergebnis[ergebnis.length - 1].art !== 'leer') ergebnis.push({ art: 'leer' });
      aktuell = null;
      continue;
    }
    if (/^\s*\|/.test(zeile)) {
      if (aktuell?.art !== 'tabelle') {
        aktuell = { art: 'tabelle', zeilen: [] };
        ergebnis.push(aktuell);
      }
      aktuell.zeilen.push(zellen(zeile));
      continue;
    }
    const titel = /^\s*#+\s+(.*)$/.exec(zeile);
    if (titel) {
      ergebnis.push({ art: 'titel', text: titel[1] });
      aktuell = null;
      continue;
    }
    if (aktuell?.art !== 'absatz') {
      aktuell = { art: 'absatz', zeilen: [] };
      ergebnis.push(aktuell);
    }
    aktuell.zeilen.push(zeile);
  }
  while (ergebnis.length && ergebnis[ergebnis.length - 1].art === 'leer') ergebnis.pop();
  return ergebnis;
}

/** HTML für den Clubdesk-Editor. Attribute statt CSS für Rahmen, damit die Tabelle überall Linien hat. */
export function alsHtml(text: string): string {
  return bloecke(text)
    .map((b) => {
      if (b.art === 'leer') return '<p>&nbsp;</p>';
      if (b.art === 'titel') return `<h3>${inlineHtml(b.text)}</h3>`;
      if (b.art === 'absatz') return `<p>${b.zeilen.map(inlineHtml).join('<br>')}</p>`;
      const breite = Math.max(...b.zeilen.map((z) => z.length));
      const zeilen = b.zeilen.map((z) => {
        const zellenHtml = z.map((c, i) => {
          const span = i === z.length - 1 && z.length < breite ? ` colspan="${breite - z.length + 1}"` : '';
          return `<td${span}>${inlineHtml(c)}</td>`;
        });
        return `<tr>${zellenHtml.join('')}</tr>`;
      });
      return `<table class="cd-tabelle" border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tbody>${zeilen.join('')}</tbody></table>`;
    })
    .join('\n');
}

/** Reiner Text (ICS, Zwischenablage ohne Formatierung). Tabellenzeilen werden «A: B». */
export function alsText(text: string): string {
  return bloecke(text)
    .map((b) => {
      if (b.art === 'leer') return '';
      if (b.art === 'titel') return inlineText(b.text);
      if (b.art === 'absatz') return b.zeilen.map(inlineText).join('\n');
      return b.zeilen
        .map((z) => {
          const [kopf, ...rest] = z.map((c) => inlineText(c).replace(/\n/g, ', '));
          return rest.length ? `${kopf}: ${rest.filter(Boolean).join(' ')}` : kopf;
        })
        .join('\n');
    })
    .join('\n');
}

/** HTML für die eigene Vorschau. Ohne style-Attribute (CSP). Die Klassen zeigen Farbe und Rahmen. */
export function fuerVorschau(html: string): string {
  return html.replace(/ style="[^"]*"/g, '');
}

/** Eine Zeile mit Auszeichnung (z. B. Tenue) als HTML für eigene Seiten: ohne style-Attribute (CSP), mit Klassen. */
export function zeileAlsHtml(text: string): string {
  return fuerVorschau(inlineHtml(text));
}

/** Eine Zeile mit Auszeichnung als reiner Text (z. B. Tenue in CSV oder Mail). */
export function zeileAlsText(text: string): string {
  return inlineText(text);
}
