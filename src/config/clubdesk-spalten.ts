// Zuordnung der Felder zu den Überschriften im Clubdesk-Export (16.1.3).
// Beim Vergleich zählen nur die Buchstaben a bis z und die Ziffern, klein geschrieben.
// So passt «[Id]» zu «id». Umlaute stören nicht, auch bei falsch erkannter Kodierung.
// Alle anderen Spalten liest das Tool nicht (z. B. IBAN, BIC, Notfallkontakt, Bemerkungen).

export type PersonFeld =
  | 'clubdesk_id'
  | 'vorname'
  | 'nachname'
  | 'geburtsdatum'
  | 'rang'
  | 'strasse'
  | 'adresszusatz'
  | 'plz'
  | 'ort'
  | 'telefon'
  | 'telefon_privat'
  | 'email'
  | 'essenseinschraenkung';

export const CLUBDESK_SPALTEN: Record<PersonFeld, { ueberschrift: string; pflicht: boolean }> = {
  clubdesk_id: { ueberschrift: '[Id]', pflicht: true },
  vorname: { ueberschrift: 'Vorname', pflicht: true },
  nachname: { ueberschrift: 'Nachname', pflicht: true },
  geburtsdatum: { ueberschrift: 'Geburtsdatum', pflicht: false },
  rang: { ueberschrift: 'Rang', pflicht: false },
  strasse: { ueberschrift: 'Adresse', pflicht: false },
  adresszusatz: { ueberschrift: 'Adress-Zusatz', pflicht: false },
  plz: { ueberschrift: 'PLZ', pflicht: false },
  ort: { ueberschrift: 'Ort', pflicht: false },
  telefon: { ueberschrift: 'Telefon Mobil', pflicht: false },
  telefon_privat: { ueberschrift: 'Telefon Privat', pflicht: false },
  email: { ueberschrift: 'E-Mail Verein', pflicht: false },
  essenseinschraenkung: { ueberschrift: 'Essenseinschränkungen', pflicht: false },
};

/** Nur Adressen mit dieser Endung gelten (16.1, Entscheid Yann). */
export const VEREINS_DOMAIN = '@web.kkb.ch';

/** Vergleichsform einer Überschrift: nur a–z und 0–9, klein. */
export function normalisiereUeberschrift(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
