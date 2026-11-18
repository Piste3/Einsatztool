// CSV schreiben für Excel: UTF-8 mit BOM, Trennzeichen «;» (19.1.2).

export function csvFeld(wert: unknown): string {
  if (wert === null || wert === undefined) return '';
  let s = String(wert);
  // Schutz vor Formeln in Excel: Text, der mit = + - @ beginnt, erhält ein Hochkomma.
  // Zahlen und Telefonnummern (z. B. «+41 79 123 45 67») bleiben unverändert.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s\/().-]+$/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvText(zeilen: unknown[][]): string {
  return '﻿' + zeilen.map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}
