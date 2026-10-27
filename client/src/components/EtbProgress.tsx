import type { EtbJob } from '../etbJob';

// "Loading payment ledgers — 2 of 10", with a bar.
export default function EtbProgress({ job }: { job: EtbJob }) {
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  return (
    <div role="status" aria-live="polite">
      <div>
        <strong>{job.stage || 'Working'}</strong>
        {job.total > 0 && (
          <>
            {' '}
            — <strong>{job.done}</strong> of <strong>{job.total}</strong>
          </>
        )}
      </div>
      <div
        style={{ height: 8, background: 'var(--neutral-bg)', borderRadius: 4, overflow: 'hidden', marginTop: 6, maxWidth: 420 }}
        aria-hidden="true"
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
      </div>
    </div>
  );
}
