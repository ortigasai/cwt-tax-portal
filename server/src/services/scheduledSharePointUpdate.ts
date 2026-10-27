import { updateFromSharePoint, SharePointUpdateSummary } from './sharepointSync';

// "Update from SharePoint" runs by itself every day at 10:00 AM (server local
// time) and can still be run by hand with the dashboard button. Both go through
// runSharePointUpdate, so a click while the daily run is going (or the reverse)
// joins that run instead of starting a second one over the same files. The
// update only downloads what changed on SharePoint, so a quiet day is quick.

export const DAILY_UPDATE_HOUR = Number(process.env.SHAREPOINT_UPDATE_HOUR ?? 10);

export interface UpdateRunInfo {
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  error: string | null;
}

let inFlight: Promise<SharePointUpdateSummary> | null = null;
let lastRun: UpdateRunInfo | null = null;
let nextRun: Date | null = null;
let timer: NodeJS.Timeout | null = null;

// The next HH:00 strictly after `now`, in local time.
export function nextRunAfter(now: Date, hour: number = DAILY_UPDATE_HOUR): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function runSharePointUpdate(trigger: 'scheduled' | 'manual'): Promise<SharePointUpdateSummary> {
  if (inFlight) return inFlight;
  const startedAt = new Date();
  const run = updateFromSharePoint()
    .then((summary) => {
      lastRun = { trigger, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), ok: true, error: null };
      return summary;
    })
    .catch((err: Error) => {
      lastRun = { trigger, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), ok: false, error: err.message };
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

function scheduleNext(): void {
  nextRun = nextRunAfter(new Date());
  timer = setTimeout(async () => {
    try {
      await runSharePointUpdate('scheduled');
      console.log('[sharepoint-update] scheduled update finished');
    } catch (err) {
      console.error('[sharepoint-update] scheduled update failed:', (err as Error).message);
    }
    scheduleNext();
  }, nextRun.getTime() - Date.now());
}

// Turn it off with SHAREPOINT_DAILY_UPDATE=off (e.g. on a machine that must not
// pull from SharePoint).
export function startDailySharePointUpdate(): void {
  if (process.env.SHAREPOINT_DAILY_UPDATE === 'off' || timer) return;
  scheduleNext();
  console.log(`[sharepoint-update] daily update scheduled — next run ${nextRun!.toString()}`);
}

export function getUpdateSchedule(): {
  enabled: boolean;
  hour: number;
  nextRunAt: string | null;
  running: boolean;
  lastRun: UpdateRunInfo | null;
} {
  return {
    enabled: timer !== null,
    hour: DAILY_UPDATE_HOUR,
    nextRunAt: nextRun ? nextRun.toISOString() : null,
    running: inFlight !== null,
    lastRun,
  };
}
