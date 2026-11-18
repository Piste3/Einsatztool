// Logs gehen auf die Standardausgabe (22.3.4). Keine Geheimnisse in Logs.
export function log(stufe: 'info' | 'warn' | 'error', meldung: string): void {
  const zeile = `${new Date().toISOString()} ${stufe.toUpperCase()} ${meldung}`;
  if (stufe === 'error') console.error(zeile);
  else console.log(zeile);
}
