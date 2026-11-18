// Prüfung von Eingaben auf dem Server (11.4.5). Fehler haben einen Text für die Oberfläche.

export class Eingabefehler extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'Eingabefehler';
  }
}

export class NichtGefunden extends Error {
  constructor(meldung = 'Nicht gefunden.') {
    super(meldung);
    this.name = 'NichtGefunden';
  }
}

/** Liest einen Text. Leer wird null. Zu lang ergibt einen Fehler. */
export function text(wert: unknown, feld: string, max = 255, pflicht = false): string | null {
  const s = typeof wert === 'string' ? wert.replace(/\r\n/g, '\n').trim() : '';
  if (!s) {
    if (pflicht) throw new Eingabefehler(`${feld} fehlt.`);
    return null;
  }
  if (s.length > max) throw new Eingabefehler(`${feld} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
}

export function pflichtText(wert: unknown, feld: string, max = 255): string {
  return text(wert, feld, max, true) as string;
}

/** Liest eine ganze Zahl. Leer wird null. */
export function ganzzahl(wert: unknown, feld: string, min = 0, max = 1_000_000): number | null {
  const s = typeof wert === 'string' ? wert.trim() : typeof wert === 'number' ? String(wert) : '';
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) throw new Eingabefehler(`${feld} muss eine ganze Zahl sein.`);
  const n = Number(s);
  if (n < min || n > max) throw new Eingabefehler(`${feld} muss zwischen ${min} und ${max} liegen.`);
  return n;
}

export function id(wert: unknown, feld = 'ID'): number {
  const n = ganzzahl(wert, feld, 1, 2_147_483_647);
  if (n === null) throw new Eingabefehler(`${feld} fehlt.`);
  return n;
}

export function auswahl<T extends string>(wert: unknown, erlaubt: readonly T[], feld: string): T {
  if (typeof wert === 'string' && (erlaubt as readonly string[]).includes(wert)) return wert as T;
  throw new Eingabefehler(`${feld} ist ungültig.`);
}

/** Liest eine Liste von Werten aus einem Formular (ein Wert oder mehrere). */
export function liste(wert: unknown): string[] {
  if (Array.isArray(wert)) return wert.filter((w): w is string => typeof w === 'string');
  if (typeof wert === 'string') return [wert];
  return [];
}

export const STATUS = ['angemeldet', 'bestaetigt', 'abgemeldet', 'unsicher', 'nachricht_gesendet'] as const;
export type Status = (typeof STATUS)[number];
export const KANAELE = ['formular', 'telefon', 'whatsapp', 'muendlich'] as const;
export type Kanal = (typeof KANAELE)[number];

export const STATUS_TEXT: Record<Status, string> = {
  angemeldet: 'angemeldet',
  bestaetigt: 'bestätigt',
  abgemeldet: 'abgemeldet',
  unsicher: 'unsicher',
  nachricht_gesendet: 'Nachricht gesendet',
};

export const KANAL_TEXT: Record<Kanal, string> = {
  formular: 'Formular',
  telefon: 'Telefon',
  whatsapp: 'WhatsApp',
  muendlich: 'mündlich',
};
