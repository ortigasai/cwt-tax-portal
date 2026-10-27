import type {
  ContractDetail,
  CtsDataResult,
  EtbComputeResponse,
  EtbRunDetail,
  EtbRunSummary,
  OnettDetail,
  OnettSummaryInfo,
  ContractSummary,
  RptTowerRecord,
  SharePointUpdateSummary,
  SyncStatus,
  SyncSummary,
  UploadIntakeSummary,
} from './types';

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

export interface DoasConnection {
  state: 'connected' | 'signin_required' | 'unreachable';
  sessionSet: boolean;
  detail: string | null;
}

export function fetchDoasStatus(): Promise<DoasConnection> {
  return request('/api/doas/status');
}

// Saves the DOAS session (a Cookie header value or a service token) and tests it.
export function saveDoasSession(session: string): Promise<DoasConnection> {
  return request('/api/doas/session', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
}

export function clearDoasSession(): Promise<DoasConnection> {
  return request('/api/doas/session', { method: 'DELETE' });
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

// Fills CTS notary date / SQM / zonal value from the DOAS batches for every
// contract still missing them (empty fields only) — see
// server/src/services/ctsDataSync.ts.
export function retrieveCtsData(): Promise<CtsDataResult> {
  return request('/api/contracts/retrieve-cts-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
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

export function uploadContractList(file: File): Promise<{
  totalFound: number;
  created: number;
  alreadyExisted: number;
  batchNumber: number;
  batchTitle: string;
  intake: UploadIntakeSummary;
  results: ContractSummary[];
}> {
  return uploadFile('/api/contracts/upload-list', file);
}

// ETB Calculator: computes each listed contract as if the buyer were ETB,
// from an optional start date (YYYY-MM-DD). See server/src/routes/etb.ts.
export function computeEtb(file: File, startDate: string): Promise<{ jobId: string; total: number }> {
  const form = new FormData();
  form.append('file', file);
  if (startDate) form.append('startDate', startDate);
  return request('/api/etb/compute', { method: 'POST', body: form });
}

// ETB Dashboard: saved calculations.
export function fetchEtbRuns(): Promise<EtbRunSummary[]> {
  return request('/api/etb/runs');
}

export function fetchEtbRun(id: number): Promise<EtbRunDetail> {
  return request(`/api/etb/runs/${id}`);
}

export function renameEtbRun(id: number, title: string): Promise<EtbRunSummary> {
  return request(`/api/etb/runs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export function deleteEtbRun(id: number): Promise<{ deleted: number }> {
  return request(`/api/etb/runs/${id}`, { method: 'DELETE' });
}

// ETB variant of a contract's Tax Payment Ledger export.
export function etbLedgerDownloadUrl(contractNumber: string, startDate: string): string {
  const query = new URLSearchParams({ etb: '1' });
  if (startDate) query.set('etbStart', startDate);
  return `${API_URL}/api/contracts/${encodeURIComponent(contractNumber)}/ledger.xlsx?${query.toString()}`;
}

// Rename a contract-list batch. An empty title resets it to the default
// (the uploaded file's name).
export function renameBatch(
  batchNumber: number,
  title: string,
): Promise<{ batchNumber: number; title: string; customTitle: string | null }> {
  return request(`/api/contracts/batches/${batchNumber}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export function uploadCustomerLedger(contractNumber: string, file: File): Promise<{ ok: boolean; paymentRecordsImported: number }> {
  return uploadFile(`/api/contracts/${encodeURIComponent(contractNumber)}/customer-ledger`, file);
}

export function uploadCtsFile(contractNumber: string, file: File): Promise<{ ok: boolean; ctsFileName: string }> {
  return uploadFile(`/api/contracts/${encodeURIComponent(contractNumber)}/cts`, file);
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

// ONE Excel file for a batch: the "Tax Payment Ledger - Duplicate" tab of every ready contract.
export function batchDuplicatesUrl(batchNumber: number): string {
  return `${API_URL}/api/contracts/batches/${batchNumber}/duplicates.xlsx`;
}

// ZIP of the payment ledgers of an explicit list of contracts.
export function selectedLedgersDownloadUrl(contractNumbers: string[]): string {
  return `${API_URL}/api/contracts/ledgers.zip?contractNumbers=${encodeURIComponent(contractNumbers.join(','))}`;
}

// ZIP of the ETB variant of an explicit list of contracts' payment ledgers.
export function etbLedgersZipUrl(contractNumbers: string[], startDate: string, runId?: number | null): string {
  const q = new URLSearchParams({ contractNumbers: contractNumbers.join(',') });
  if (startDate) q.set('startDate', startDate);
  // With a run id each contract uses the start date saved on that run.
  if (runId != null) q.set('runId', String(runId));
  return `${API_URL}/api/etb/ledgers.zip?${q.toString()}`;
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

// ONETT Summary: scanned ONETT computation sheets -> summary workbook.
export function fetchOnettStatus(): Promise<{ autoExtraction: boolean; mode: 'api' | 'cli' | null; note: string }> {
  return request('/api/onett/status');
}

export function fetchOnettSummaries(): Promise<OnettSummaryInfo[]> {
  return request('/api/onett/summaries');
}

export function fetchOnettSummary(id: number): Promise<OnettDetail> {
  return request(`/api/onett/summaries/${id}`);
}

export function createOnettSummary(files: File[], title: string): Promise<OnettSummaryInfo & { problems: string[] }> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (title.trim()) form.append('title', title.trim());
  return request('/api/onett/summaries', { method: 'POST', body: form });
}

export function importOnettAccounts(body: { title?: string; summaryId?: number; accounts: unknown }): Promise<OnettDetail> {
  return request('/api/onett/summaries/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function renameOnettSummary(id: number, title: string): Promise<OnettDetail> {
  return request(`/api/onett/summaries/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export function extractOnettSummary(id: number): Promise<OnettSummaryInfo> {
  return request(`/api/onett/summaries/${id}/extract`, { method: 'POST' });
}

export function deleteOnettSummary(id: number): Promise<{ deleted: number }> {
  return request(`/api/onett/summaries/${id}`, { method: 'DELETE' });
}

export function onettExportUrl(id: number): string {
  return `${API_URL}/api/onett/summaries/${id}/export.xlsx`;
}

export function onettPageUrl(id: number, page: number): string {
  return `${API_URL}/api/onett/summaries/${id}/pages/${page}`;
}

export function deleteOnettSummaries(ids: number[]): Promise<{ deleted: number }> {
  return request('/api/onett/summaries/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export function removeOnettAccounts(id: number, dockets: string[]): Promise<OnettDetail> {
  return request(`/api/onett/summaries/${id}/remove-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dockets }),
  });
}

// Reference data (1606 Summary, FMV table, zonal values) is read-only in the app.
export function fetchReferenceConfig(): Promise<{
  locked: boolean;
  message: string;
  dataSyncFolder: string | null;
  zonalValuesFolder: string | null;
}> {
  return request('/api/reference/config');
}

// The ETB upload template: Contract Number + Start Date of ETB, one row per contract.
export function etbTemplateUrl(): string {
  return `${API_URL}/api/etb/template.xlsx`;
}

// Progress (and finally the result) of a calculation started with computeEtb.
export interface EtbJobProgress {
  status: 'running' | 'done' | 'error';
  stage: string;
  done: number;
  total: number;
  elapsedSeconds: number;
  result?: EtbComputeResponse;
  error?: string;
}

export function fetchEtbJob(jobId: string): Promise<EtbJobProgress> {
  return request(`/api/etb/jobs/${jobId}`);
}

// POSTs a JSON body to an endpoint that answers with an Excel file and saves it.
async function downloadExcelPost(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Export failed: ${res.status}`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The dashboard status as an Excel file (the contracts currently shown).
export function downloadDashboardStatus(contractNumbers: string[]): Promise<void> {
  return downloadExcelPost('/api/contracts/status.xlsx', { contractNumbers }, 'Pre-ONETT Dashboard Status.xlsx');
}

// The ETB calculation's status as an Excel file (the rows currently shown).
export function downloadEtbStatus(runId: number, contractNumbers: string[]): Promise<void> {
  return downloadExcelPost(`/api/etb/runs/${runId}/status.xlsx`, { contractNumbers }, 'ETB Status.xlsx');
}
