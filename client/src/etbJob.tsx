import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeEtb, fetchEtbJob } from './api/client';
import type { EtbComputeResponse } from './api/types';

// One ETB calculation at a time, held above the pages so its progress and result
// stay while you move between the ETB Dashboard and the calculator. The work
// itself runs on the server: if the browser tab is closed or reloaded it still
// finishes and shows up as a new calculation on the ETB Dashboard.

export interface EtbJob {
  status: 'idle' | 'running' | 'done' | 'error';
  fileName: string | null;
  /** The file and default start date of the last run, so it can be re-run. */
  file: File | null;
  defaultStart: string;
  startedAt: number | null;
  /** What the server is working on and how many contracts are through it. */
  stage: string;
  done: number;
  total: number;
  result: EtbComputeResponse | null;
  error: string | null;
}

interface EtbJobApi {
  job: EtbJob;
  start: (file: File, defaultStart: string) => void;
  dismiss: () => void;
}

const IDLE: EtbJob = {
  status: 'idle',
  fileName: null,
  file: null,
  defaultStart: '',
  startedAt: null,
  stage: '',
  done: 0,
  total: 0,
  result: null,
  error: null,
};

const Ctx = createContext<EtbJobApi | null>(null);

export function EtbJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<EtbJob>(IDLE);
  const running = useRef(false);

  const start = useCallback((file: File, defaultStart: string) => {
    if (running.current) return;
    running.current = true;
    setJob({
      status: 'running',
      fileName: file.name,
      file,
      defaultStart,
      startedAt: Date.now(),
      stage: 'Uploading the file',
      done: 0,
      total: 0,
      result: null,
      error: null,
    });
    const fail = (message: string) => {
      running.current = false;
      setJob((j) => ({ ...j, status: 'error', error: message }));
    };
    computeEtb(file, defaultStart)
      .then(({ jobId, total }) => {
        setJob((j) => ({ ...j, stage: 'Preparing contracts', total }));
        // Follow the server-side calculation until it finishes.
        let failures = 0;
        const poll = async () => {
          try {
            const p = await fetchEtbJob(jobId);
            failures = 0;
            if (p.status === 'running') {
              setJob((j) => ({ ...j, stage: p.stage, done: p.done, total: p.total }));
              window.setTimeout(poll, 1200);
            } else if (p.status === 'done' && p.result) {
              running.current = false;
              setJob((j) => ({ ...j, status: 'done', stage: 'Done', done: p.total, total: p.total, result: p.result ?? null }));
            } else {
              fail(p.error ?? 'The calculation failed');
            }
          } catch (e) {
            // The server can be briefly unresponsive while it imports the 1606 Summary.
            if (++failures < 10) window.setTimeout(poll, 2000);
            else fail((e as Error).message);
          }
        };
        void poll();
      })
      .catch((e: Error) => fail(e.message));
  }, []);

  const dismiss = useCallback(() => {
    if (!running.current) setJob(IDLE);
  }, []);

  const api = useMemo(() => ({ job, start, dismiss }), [job, start, dismiss]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEtbJob(): EtbJobApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useEtbJob must be used inside EtbJobProvider');
  return api;
}
