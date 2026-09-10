import type { ContractDetail, ContractSummary, RptTowerRecord, SharePointUpdateSummary, SyncStatus, SyncSummary } from './types';

// Derived from the hostname the page was actually loaded from (localhost,
// 127.0.0.1, or this machine's LAN IP) rather than a hardcoded "localhost" —
// otherwise a laptop on the LAN would call its own localhost:4100 instead of
// the server's.
const API_URL = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:4100`;

// Set by App.tsx so any request that comes back 401 (session missing/expired)
// can bounce the user to the login screen immediately, from anywhere in the app.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include' });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? 'Login failed');
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

export async function checkAuth(): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
  if (!res.ok) return false;
  const body = await res.json();
  return body.authenticated === true;
}

export function fetchContracts(): Promise<ContractSummary[]> {
  return request('/api/contracts');
}

export function fetchSyncStatus(): Promise<SyncStatus> {
  return request('/api/sync/status');
}

export function deleteContracts(contractNumbers: string[]): Promise<{ deleted: number }> {
  return request('/api/contracts/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractNumbers }),
  });
}

export function triggerSync(force = false): Promise<SyncSummary> {
  return request(`/api/sync${force ? '?force=1' : ''}`, { method: 'POST' });
}

// Pulls the OCLP 1606 Summary and Zonal Value files straight from
// SharePoint (via the IT-issued API) and re-syncs — see
// server/src/services/sharepointSync.ts.
export function updateFromSharePoint(): Promise<SharePointUpdateSummary> {
  return request('/api/sync/from-sharepoint', { method: 'POST' });
}

export function fetchContract(contractNumber: string): Promise<ContractDetail> {
  return request(`/api/contracts/${encodeURIComponent(contractNumber)}`);
}

export function updateContract(
  contractNumber: string,
  patch: Partial<{
    ctsNotaryDate: string | null;
    sqmUnit: number | null;
    sqmParking: number | null;
    sqmStorage: number | null;
    zonalValuePerSqmUnit: number | null;
    zonalValuePerSqmParking: number | null;
    matchedRptRecordId: string | null;
    matchedParkingRptRecordId: string | null;
    matchedStorageRptRecordId: string | null;
    notes: string | null;
  }>,
): Promise<void> {
  return request(`/api/contracts/${encodeURIComponent(contractNumber)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return request(path, { method: 'POST', body: form });
}

export function uploadContractList(
  file: File,
): Promise<{ totalFound: number; created: number; alreadyExisted: number; syncSummary: SyncSummary }> {
  return uploadFile('/api/contracts/upload-list', file);
}

export function uploadCustomerLedger(contractNumber: string, file: File): Promise<{ ok: boolean; paymentRecordsImported: number }> {
  return uploadFile(`/api/contracts/${encodeURIComponent(contractNumber)}/customer-ledger`, file);
}

export function uploadCtsFile(contractNumber: string, file: File): Promise<{ ok: boolean; ctsFileName: string }> {
  return uploadFile(`/api/contracts/${encodeURIComponent(contractNumber)}/cts`, file);
}

export function uploadOclp1606(
  file: File,
): Promise<{ totalRows: number; matchedRows: number; unmatchedRows: number; contractsUpdated: number }> {
  return uploadFile('/api/reference/oclp-1606/upload', file);
}

export function uploadRptTowers(file: File): Promise<{ rowsImported: number }> {
  return uploadFile('/api/reference/rpt-towers/upload', file);
}

export function searchRptTowers(query: string): Promise<RptTowerRecord[]> {
  return request(`/api/reference/rpt-towers/search?q=${encodeURIComponent(query)}`);
}

export function fetchZonalValueRegions(): Promise<{ regions: { region: string }[]; sourceUrl: string }> {
  return request('/api/zonal-values/regions');
}

export function fetchRdoLocations(): Promise<{ locations: { rdo: string; towers: string[] }[] }> {
  return request('/api/zonal-values/rdo-locations');
}

export function zonalLookup(contractNumber: string): Promise<import('./types').ZonalLookupResult> {
  return request(`/api/zonal-values/lookup/${encodeURIComponent(contractNumber)}`);
}

export function zonalSearch(
  tower: string | null,
  date: string | null,
  q: string,
): Promise<import('./types').ZonalLookupResult> {
  const params = new URLSearchParams();
  if (tower) params.set('tower', tower);
  if (date) params.set('date', date);
  params.set('q', q);
  return request(`/api/zonal-values/search?${params.toString()}`);
}

export function ledgerDownloadUrl(contractNumber: string): string {
  return `${API_URL}/api/contracts/${encodeURIComponent(contractNumber)}/ledger.xlsx`;
}

// ZIP of every contract's Tax Payment Ledger, optionally limited to one batch.
export function allLedgersDownloadUrl(batchNumber?: number): string {
  const query = batchNumber !== undefined ? `?batchNumber=${batchNumber}` : '';
  return `${API_URL}/api/contracts/ledgers.zip${query}`;
}

export function ctsDownloadUrl(contractNumber: string): string {
  return `${API_URL}/api/contracts/${encodeURIComponent(contractNumber)}/cts`;
}

export function dstTransferTaxTemplateUrl(): string {
  return `${API_URL}/api/dst-transfer-tax/template.xlsx`;
}

// Returns the computed workbook as a Blob (not JSON) — the caller triggers
// the browser download itself, same idea as ledgerDownloadUrl but this one
// has to be a POST (the request carries the uploaded file), so it can't just
// be a plain <a href>.
export async function computeDstTransferTax(file: File): Promise<Blob> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/api/dst-transfer-tax/compute`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.blob();
}
