// Kopiert Dateien, die TypeScript nicht übersetzt (Schema, CSS, Browser-Skripte), nach dist/.
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const paare = [
  ['src/db/schema.sql', 'dist/src/db/schema.sql'],
  ['src/web/public', 'dist/src/web/public'],
];
for (const [von, nach] of paare) {
  mkdirSync(dirname(join(wurzel, nach)), { recursive: true });
  cpSync(join(wurzel, von), join(wurzel, nach), { recursive: true });
}
