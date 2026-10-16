// Reference data (the OCLP 1606 Summary, the RPT_ALL TOWERS FMV table and the
// zonal values) comes only from its configured sources — the DATA_SYNC_DIR /
// ZONAL_VALUES_DIR folders, SharePoint and the DOAS batches — never from edits
// in the web app. Whoever controls the server's .env can lift the lock with
// ALLOW_REFERENCE_EDITS=true (default: locked).
export function referenceDataLocked(): boolean {
  return process.env.ALLOW_REFERENCE_EDITS?.trim().toLowerCase() !== 'true';
}

export const REFERENCE_LOCKED_MESSAGE =
  'Reference data (OCLP 1606 Summary, RPT/FMV table, zonal values) is read-only in the web app. ' +
  'It is loaded only from the configured source folders — update the file there and run a sync.';
