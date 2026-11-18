// Startdaten. Nur wenn die Tabellen leer sind.
// Ränge: keine Startwerte (Entscheid Yann, offener Punkt 9.2). Der Admin legt sie an.
// Der erste Admin entsteht beim ersten Login mit der Entra-Rolle Admin (22.1).
import { alle, schreibe, transaktion, type Db } from './db.js';

export async function seed(db: Db): Promise<void> {
  await transaktion(db, async (c) => {
    const [{ anzahl }] = await alle<{ anzahl: number }>(c, 'SELECT COUNT(*) AS anzahl FROM rolle');
    if (Number(anzahl) > 0) return;
    await schreibe(
      c,
      `INSERT INTO rolle (name, reihenfolge, zaehlt_teilnehmer) VALUES
        ('Einsatzleitung', 1, 1), ('Busfahrer', 2, 1), ('Sektorchef', 3, 0)`,
    );
  });
}
