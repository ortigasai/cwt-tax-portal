import type { ExposureStatus } from '../api/types';

const LABELS: Record<ExposureStatus, string> = {
  COMPLIANT: 'Compliant',
  UNDER_REMITTED: 'Under-remitted',
  MISSING_DATA: 'Missing data',
};

const CLASSES: Record<ExposureStatus, string> = {
  COMPLIANT: 'badge-compliant',
  UNDER_REMITTED: 'badge-under-remitted',
  MISSING_DATA: 'badge-missing-data',
};

export default function StatusBadge({ status }: { status: ExposureStatus }) {
  return <span className={`badge ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
