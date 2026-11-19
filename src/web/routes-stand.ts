// Datenstand für die Anzeige von Änderungen anderer Benutzer.
// Die Seite fragt den Stand alle 15 Sekunden ab. Ändert er sich, zeigt sie einen Hinweis.
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { k } from './kontext.js';
import type { Db } from '../db/db.js';
import { datenstandEinsatz } from '../domain/datenstand.js';
import { id as leseId } from '../domain/eingabe.js';
import type { SeitenStand } from './views/layout.js';

/** Pfad für die Abfrage des Datenstands. Die Abfrage verlängert die Sitzung nicht. */
export const STAND_PFAD = '/stand/einsatz/';

export async function seitenStand(db: Db, einsatzId: number): Promise<SeitenStand> {
  return { url: `${STAND_PFAD}${einsatzId}`, wert: await datenstandEinsatz(db, einsatzId) };
}

export function registriereStand(app: Express, deps: Abhaengigkeiten): void {
  app.get(`${STAND_PFAD}:id`, async (req, res) => {
    // Ohne Sitzung kein Stand. Das Skript hört dann auf zu fragen.
    if (!k(res).benutzer) {
      res.status(401).json({ fehler: 'nicht angemeldet' });
      return;
    }
    res.json({ stand: await datenstandEinsatz(deps.db, leseId(req.params.id)) });
  });
}
