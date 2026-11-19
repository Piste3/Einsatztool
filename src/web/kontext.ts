// Kontext einer Anfrage: Benutzer, CSRF-Token, Zähler, Meldung.
import type { Request, Response } from 'express';
import type { Benutzer } from '../domain/stammdaten.js';

export interface Meldung {
  art: 'ok' | 'fehler' | 'hinweis';
  text: string;
  /** Schlüssel für den Knopf «Rückgängig» im Toast (src/domain/rueckgaengig.ts). */
  rueckgaengig?: string;
}

export interface Kontext {
  benutzer: Benutzer | null;
  sitzungId: string | null;
  csrf: string;
  zaehler: { unbestaetigt: number; unbekannt: number };
  meldung: Meldung | null;
  pfad: string;
}

export function k(res: Response): Kontext {
  return res.locals.k as Kontext;
}

/** Pfad und Abfrage der aktuellen Seite (für Rücksprung nach dem Speichern). */
export function aktuellerPfad(req: Request): string {
  return req.originalUrl;
}

/** Prüft ein Rücksprung-Ziel. Nur Pfade dieser Seite sind erlaubt. */
export function sicheresZiel(wert: unknown, standard: string): string {
  if (typeof wert !== 'string') return standard;
  if (!wert.startsWith('/') || wert.startsWith('//') || wert.startsWith('/\\') || /[\r\n]/.test(wert)) return standard;
  return wert;
}
