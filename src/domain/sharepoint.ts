// Upload nach SharePoint über Microsoft Graph (19.1.4 bis 19.1.6). Nutzt fetch, keine Bibliothek.
// Anmeldung: Client-Credentials mit der Entra-App. Berechtigung: Sites.Selected für die Site.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface SharePointEinstellungen {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string;
  ordner: string;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRENZE_EINFACH = 4 * 1024 * 1024;
const TEILGROESSE = 320 * 1024 * 10; // Vielfaches von 320 KiB, wie Graph es verlangt

export function sharePointBereit(e: SharePointEinstellungen): boolean {
  return !!(e.tenantId && e.clientId && e.clientSecret && e.siteId && e.driveId);
}

function pfadTeil(pfad: string): string {
  return pfad.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

export class SharePoint {
  private token: { wert: string; ablauf: number } | null = null;

  constructor(private e: SharePointEinstellungen, private f: FetchFn = fetch) {}

  private async holeToken(): Promise<string> {
    if (this.token && this.token.ablauf > Date.now() + 60000) return this.token.wert;
    const body = new URLSearchParams({
      client_id: this.e.clientId,
      client_secret: this.e.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const r = await this.f(`https://login.microsoftonline.com/${encodeURIComponent(this.e.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`Anmeldung bei Microsoft Graph fehlgeschlagen (HTTP ${r.status}).`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { wert: j.access_token, ablauf: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  private basis(): string {
    return `${GRAPH}/sites/${encodeURIComponent(this.e.siteId)}/drives/${encodeURIComponent(this.e.driveId)}`;
  }

  /** Lädt eine Datei hoch und überschreibt eine bestehende. Über 4 MB mit einer Upload-Session. */
  async lade(unterordner: string, dateiname: string, inhalt: Buffer): Promise<void> {
    const token = await this.holeToken();
    const pfad = pfadTeil(`${this.e.ordner}/${unterordner}/${dateiname}`);
    if (inhalt.length <= GRENZE_EINFACH) {
      const r = await this.f(`${this.basis()}/root:/${pfad}:/content`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(inhalt),
      });
      if (!r.ok) throw new Error(`Upload von ${dateiname} fehlgeschlagen (HTTP ${r.status}).`);
      return;
    }
    const s = await this.f(`${this.basis()}/root:/${pfad}:/createUploadSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    if (!s.ok) throw new Error(`Upload-Session für ${dateiname} fehlgeschlagen (HTTP ${s.status}).`);
    const { uploadUrl } = (await s.json()) as { uploadUrl: string };
    for (let start = 0; start < inhalt.length; start += TEILGROESSE) {
      const ende = Math.min(start + TEILGROESSE, inhalt.length);
      const r = await this.f(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(ende - start), 'Content-Range': `bytes ${start}-${ende - 1}/${inhalt.length}` },
        body: new Uint8Array(inhalt.subarray(start, ende)),
      });
      if (!r.ok) throw new Error(`Upload von ${dateiname} fehlgeschlagen (HTTP ${r.status}).`);
    }
  }

  /** Listet Dateinamen in einem Unterordner. */
  async liste(unterordner: string): Promise<{ id: string; name: string }[]> {
    const token = await this.holeToken();
    const pfad = pfadTeil(`${this.e.ordner}/${unterordner}`);
    const r = await this.f(`${this.basis()}/root:/${pfad}:/children?$select=id,name&$top=999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`Liste von ${unterordner} fehlgeschlagen (HTTP ${r.status}).`);
    const j = (await r.json()) as { value: { id: string; name: string }[] };
    return j.value ?? [];
  }

  async loesche(id: string): Promise<void> {
    const token = await this.holeToken();
    const r = await this.f(`${this.basis()}/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok && r.status !== 404) throw new Error(`Löschen fehlgeschlagen (HTTP ${r.status}).`);
  }
}
