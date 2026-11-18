// HTML-Vorlagen. Jeder eingesetzte Wert wird maskiert (22.2.2), ausser er ist ausdrücklich «Roh».

export class Roh {
  constructor(public readonly s: string) {}
  toString(): string {
    return this.s;
  }
}

export function maskiere(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Wert = unknown;

function alsText(w: Wert): string {
  if (w === null || w === undefined || w === false) return '';
  if (w instanceof Roh) return w.s;
  if (Array.isArray(w)) return w.map(alsText).join('');
  return maskiere(String(w));
}

/** Vorlage: html`<p>${text}</p>` maskiert text. */
export function html(teile: TemplateStringsArray, ...werte: Wert[]): Roh {
  let s = teile[0];
  for (let i = 0; i < werte.length; i++) s += alsText(werte[i]) + teile[i + 1];
  return new Roh(s);
}

/** Text mit Zeilenumbrüchen als <br>. */
export function mehrzeilig(t: string | null | undefined): Roh {
  if (!t) return new Roh('');
  return new Roh(maskiere(t).replace(/\n/g, '<br>'));
}

/** Attribut nur setzen, wenn Bedingung wahr. */
export function wenn(bedingung: unknown, inhalt: Wert): Roh {
  return new Roh(bedingung ? alsText(inhalt) : '');
}

export function ausgewaehlt(a: unknown, b: unknown): Roh {
  return new Roh(String(a) === String(b) ? ' selected' : '');
}

export function angehakt(b: unknown): Roh {
  return new Roh(b ? ' checked' : '');
}
