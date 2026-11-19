// Meldet jede gespeicherte Änderung an die offenen Seiten aller Benutzer (Live-Aktualisierung).
// Ein Server-Prozess genügt (CLAUDE.md). Darum liegt der Zähler im Speicher.

type Zuhoerer = (nr: number) => void;

let nr = 0;
const zuhoerer = new Set<Zuhoerer>();

/** Aktueller Stand. Er steigt bei jeder abgeschlossenen Transaktion. */
export function aenderungsStand(): number {
  return nr;
}

/** Zählt eine Änderung und meldet sie allen Zuhörern. */
export function meldeAenderung(): void {
  nr++;
  for (const z of zuhoerer) {
    try {
      z(nr);
    } catch {
      // Ein Fehler bei einem Zuhörer stört die anderen nicht.
    }
  }
}

/** Meldet sich für Änderungen an. Gibt eine Funktion zum Abmelden zurück. */
export function hoereAenderungen(z: Zuhoerer): () => void {
  zuhoerer.add(z);
  return () => zuhoerer.delete(z);
}
