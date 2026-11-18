// Erzeugt eine Clubdesk-CSV wie im Beispiel-Export: «;», alle Felder in Anführungszeichen, Windows-1252.
export interface CsvPerson {
  id: number;
  vorname: string;
  nachname: string;
  geburtsdatum?: string;
  rang?: string;
  email?: string;
  telefon?: string;
  essen?: string;
  iban?: string;
  notfall?: string;
  bemerkung?: string;
}

const KOPF = ['[Id]', 'Benutzer-Id', 'Vorname', 'Nachname', 'Geburtsdatum', 'Alter', 'Rang', 'Adresse', 'Adress-Zusatz', 'PLZ', 'Ort',
  'Telefon Mobil', 'Telefon Privat', 'Telefon Geschäft', 'E-Mail', 'E-Mail Verein', 'E-Mail Alternativ', 'Essenseinschränkungen',
  'IBAN', 'BIC', 'Notfallkontakt', 'Bemerkungen'];

function latin1(text: string): Buffer {
  // Windows-1252 für die hier genutzten Zeichen (Umlaute) entspricht Latin-1.
  return Buffer.from(text, 'latin1');
}

export function clubdeskCsv(personen: CsvPerson[]): Buffer {
  const q = (s: string | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const zeilen = [KOPF.map(q).join(';')];
  for (const p of personen) {
    zeilen.push([
      String(p.id), String(9000 + p.id), p.vorname, p.nachname, p.geburtsdatum ?? '', '17', p.rang ?? '', 'Weg 1', '', '4000', 'Basel',
      p.telefon ?? '', '', '', 'privat@example.ch', p.email ?? '', 'alt@example.ch', p.essen ?? '', p.iban ?? '', p.iban ? 'POFICHBEXXX' : '',
      p.notfall ?? '', p.bemerkung ?? '',
    ].map(q).join(';'));
  }
  return latin1(zeilen.join('\r\n') + '\r\n');
}
