// Thin client for the IT-issued "Prompters API broker" — read-only, scoped
// access to specific SharePoint document libraries via an API key, no
// browser/MFA login required. See server/.env for the key and
// https://paba.ortigasland.com.ph/api/v1 for the API itself (OpenAPI specs
// were provided directly by IT for the "tax-team-api" and
// "property-sales-api" scopes).

const BASE_URL = 'https://paba.ortigasland.com.ph/api/v1';

export type SharePointScope = 'tax-team-api' | 'property-sales-api';

function apiKeyFor(scope: SharePointScope): string {
  const key = scope === 'tax-team-api' ? process.env.TAX_TEAM_API_KEY : process.env.PROPERTY_SALES_API_KEY;
  if (!key) throw new Error(`No API key configured for SharePoint scope "${scope}" — set it in server/.env`);
  return key;
}

async function request(scope: SharePointScope, endpoint: string, path: string): Promise<Response> {
  const url = `${BASE_URL}/scopes/${scope}/${endpoint}/?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: { 'X-API-Key': apiKeyFor(scope) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SharePoint API ${endpoint} failed (${res.status}) for "${path}": ${body}`);
  }
  return res;
}

export interface SharePointItemMetadata {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modified_at: string;
  [key: string]: unknown;
}

// GET item metadata (used to check whether a file changed before
// downloading it, since these can be tens of MB).
export async function fetchMetadata(scope: SharePointScope, path: string): Promise<SharePointItemMetadata> {
  const res = await request(scope, 'metadata', path);
  return (await res.json()) as SharePointItemMetadata;
}

// GET the raw bytes of a file.
export async function downloadFile(scope: SharePointScope, path: string): Promise<Buffer> {
  const res = await request(scope, 'content', path);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
