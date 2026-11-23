// Sperre während eines Updates oder Neustarts (Wunsch Yann, 23.11.2026).
// Während das Update läuft, sehen alle angemeldeten Seiten ein Fenster. Es sperrt jede Eingabe.
// Der Server nimmt in dieser Zeit keine Änderungen von angemeldeten Benutzern an.
// Nach dem Neustart lädt jede Seite die neue Version und setzt offene Eingaben wieder ein (wartung.js).
// Ein Server-Prozess genügt (CLAUDE.md). Darum liegt der Zustand im Speicher.

export type WartungsGrund = 'update' | 'neustart';

export interface Wartung {
  grund: WartungsGrund;
  seit: string;
}

/** Ändert sich bei jedem Start. Die Seiten erkennen daran die neue Version. */
export const START_ID = Date.now().toString(36);

/** Diese POST-Adressen gehen auch während der Sperre (Update-Seite des Admins, Abmelden). */
const FREI = [/^\/admin\/update(\/|$)/, /^\/logout$/];

type Zuhoerer = (w: Wartung | null) => void;

let aktuell: Wartung | null = null;
const zuhoerer = new Set<Zuhoerer>();

/** Aktuelle Sperre oder null. */
export function wartung(): Wartung | null {
  return aktuell;
}

/** Setzt oder beendet die Sperre und meldet sie allen offenen Seiten. */
export function setzeWartung(grund: WartungsGrund | null): void {
  if (grund === (aktuell?.grund ?? null)) return;
  aktuell = grund ? { grund, seit: new Date().toISOString() } : null;
  for (const z of zuhoerer) {
    try {
      z(aktuell);
    } catch {
      // Ein Fehler bei einem Zuhörer stört die anderen nicht.
    }
  }
}

/** Meldet sich für Änderungen der Sperre an. Gibt eine Funktion zum Abmelden zurück. */
export function hoereWartung(z: Zuhoerer): () => void {
  zuhoerer.add(z);
  return () => zuhoerer.delete(z);
}

/** Prüft, ob ein POST während der Sperre durchgeht. */
export function postFrei(pfad: string): boolean {
  return FREI.some((m) => m.test(pfad));
}

/** Text für Fenster und Hinweis. */
export function wartungsText(w: Wartung): string {
  return w.grund === 'update'
    ? 'Ein Admin installiert gerade ein Update. Bitte warte. Danach geht es mit der neuen Version weiter.'
    : 'Der Server startet gerade neu. Bitte warte. Danach geht es automatisch weiter.';
}

/** Daten für die Live-Meldungen: Start-Kennung und Sperre. */
export function liveDaten(): { start: string; wartung: WartungsGrund | null } {
  return { start: START_ID, wartung: aktuell?.grund ?? null };
}
