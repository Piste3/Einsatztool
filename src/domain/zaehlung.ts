// Zählung je Schicht (13.6).
import { alle, type Db } from '../db/db.js';

export interface RollenZahl {
  rolle: string;
  ist: number;
  soll: number;
}

export interface SchichtZahlen {
  /** Bestätigte Einträge ohne Rolle oder mit zählender Rolle, plus Fremdabteilungen. */
  teilnehmende: number;
  bestaetigt: number;
  unbestaetigt: number;
  unsicher: number;
  nachricht: number;
  abgemeldet: number;
  fremd: number;
  /** Teilnehmende plus bestätigte Rollen ohne Teilnehmerzählung (z. B. Sektorchef). */
  essen: number;
  rollen: RollenZahl[];
}

function leer(): SchichtZahlen {
  return { teilnehmende: 0, bestaetigt: 0, unbestaetigt: 0, unsicher: 0, nachricht: 0, abgemeldet: 0, fremd: 0, essen: 0, rollen: [] };
}

export async function zahlenFuerSchichten(db: Db, schichtIds: number[]): Promise<Map<number, SchichtZahlen>> {
  const ergebnis = new Map<number, SchichtZahlen>();
  for (const id of schichtIds) ergebnis.set(id, leer());
  if (!schichtIds.length) return ergebnis;

  const status = await alle<{ schicht_id: number; status: string; zaehlt: number | null; n: number }>(
    db,
    `SELECT a.schicht_id, a.status, r.zaehlt_teilnehmer AS zaehlt, COUNT(*) AS n
       FROM anmeldung a LEFT JOIN rolle r ON r.name = a.rolle
      WHERE a.schicht_id IN (?)
      GROUP BY a.schicht_id, a.status, r.zaehlt_teilnehmer`,
    [schichtIds],
  );
  for (const z of status) {
    const s = ergebnis.get(z.schicht_id)!;
    const n = Number(z.n);
    switch (z.status) {
      case 'bestaetigt':
        s.bestaetigt += n;
        // Rolle leer oder Rolle zählt als Teilnehmer.
        if (z.zaehlt === null || Number(z.zaehlt) === 1) s.teilnehmende += n;
        // Alle Bestätigten essen mit, auch Rollen ohne Teilnehmerzählung.
        s.essen += n;
        break;
      case 'angemeldet':
        s.unbestaetigt += n;
        break;
      case 'unsicher':
        s.unsicher += n;
        break;
      case 'nachricht_gesendet':
        s.nachricht += n;
        break;
      case 'abgemeldet':
        s.abgemeldet += n;
        break;
    }
  }

  const fremd = await alle<{ schicht_id: number; n: number }>(
    db,
    'SELECT schicht_id, SUM(anzahl) AS n FROM fremdabteilung WHERE schicht_id IN (?) GROUP BY schicht_id',
    [schichtIds],
  );
  for (const z of fremd) {
    const s = ergebnis.get(z.schicht_id)!;
    const n = Number(z.n);
    // Fremdabteilungen zählen als TN und beim Essen.
    s.fremd = n;
    s.teilnehmende += n;
    s.essen += n;
  }

  const rollen = await alle<{ schicht_id: number; rolle: string; soll: number; ist: number; reihenfolge: number }>(
    db,
    `SELECT sr.schicht_id, sr.rolle, sr.anzahl AS soll, r.reihenfolge,
            (SELECT COUNT(*) FROM anmeldung a WHERE a.schicht_id = sr.schicht_id AND a.rolle = sr.rolle AND a.status = 'bestaetigt') AS ist
       FROM schicht_rolle sr JOIN rolle r ON r.name = sr.rolle
      WHERE sr.schicht_id IN (?)
      ORDER BY r.reihenfolge, sr.rolle`,
    [schichtIds],
  );
  for (const z of rollen) {
    ergebnis.get(z.schicht_id)!.rollen.push({ rolle: z.rolle, ist: Number(z.ist), soll: Number(z.soll) });
  }
  return ergebnis;
}

/** Farbe für Ist / Soll: voll = grün, mindestens 80 % = orange, sonst rot. */
export function sollFarbe(ist: number, soll: number | null): 'gruen' | 'orange' | 'rot' | 'neutral' {
  if (soll === null || soll <= 0) return 'neutral';
  if (ist >= soll) return 'gruen';
  if (ist >= soll * 0.8) return 'orange';
  return 'rot';
}
