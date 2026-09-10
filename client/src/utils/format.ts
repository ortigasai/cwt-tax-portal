export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// mm/dd/yyyy, zero-padded. Uses UTC getters since these values are pure
// calendar dates (CTS notary date, payment/deadline dates) stored as
// midnight-UTC — reading them with local getters could shift the date by a
// day depending on the viewer's timezone offset.
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
