// Upload-Datei des Imports: liegt im Ordner import/ im Datenordner (Entscheid Yann).
// Das Tool löscht sie nach dem Anwenden, sonst nach einer Stunde.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Eingabefehler } from './eingabe.js';

const NAME = /^[a-f0-9]{32}\.csv$/;

function ordner(dataDir: string): string {
  const o = join(dataDir, 'import');
  mkdirSync(o, { recursive: true });
  return o;
}

export function speichereImportdatei(dataDir: string, inhalt: Buffer): string {
  const name = `${randomBytes(16).toString('hex')}.csv`;
  writeFileSync(join(ordner(dataDir), name), inhalt);
  return name;
}

export function ladeImportdatei(dataDir: string, name: unknown): Buffer {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Eingabefehler('Die Import-Datei ist ungültig.');
  const pfad = join(ordner(dataDir), name);
  if (!existsSync(pfad)) throw new Eingabefehler('Die Import-Datei ist abgelaufen. Lade die CSV erneut hoch.');
  return readFileSync(pfad);
}

export function loescheImportdatei(dataDir: string, name: string): void {
  if (!NAME.test(name)) return;
  try {
    unlinkSync(join(ordner(dataDir), name));
  } catch {
    // Datei schon weg
  }
}

export function raeumeImportdateienAuf(dataDir: string, jetzt = Date.now()): number {
  let n = 0;
  const o = ordner(dataDir);
  for (const name of readdirSync(o)) {
    if (!NAME.test(name)) continue;
    const pfad = join(o, name);
    if (jetzt - statSync(pfad).mtimeMs > 60 * 60 * 1000) {
      unlinkSync(pfad);
      n++;
    }
  }
  return n;
}
