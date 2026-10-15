'use client';
import { useEffect, useState } from 'react';

type Job = {
  state: string;
  txId?: string;
  blockHeight?: number;
  flagIndex?: number;
  attKey?: string;
  error?: { code: string; message: string };
  links?: { label: string; href: string }[];
};
const STEPS = ['queued', 'tagging', 'proving', 'sponsoring', 'confirmed'];

// "Refused as designed": refusals that are the system working, not failing.
export const DESIGNED_REFUSALS = new Set(['duplicate-flag', 'not-a-member', 'duplicate-pseudonym', 'self-excluded', 'insufficient', 'already-attested', 'quota']);

export function JobTracker({ bank, jobId, onDone }: { bank: string; jobId: string; onDone?: (j: Job) => void }) {
  const [job, setJob] = useState<Job>({ state: 'queued' });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const j = (await (await fetch(`/api/bank/${bank}/jobs/${jobId}`)).json()) as Job;
      if (stop) return;
      setJob(j);
      if (j.state === 'confirmed' || j.state === 'failed') onDone?.(j);
      else setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [bank, jobId, onDone]);

  const at = STEPS.indexOf(job.state);
  return (
    <div className="card stack">
      <div className="timeline">
        {STEPS.map((s, i) => (
          <span key={s} className={i <= at || job.state === 'confirmed' ? 'on' : ''}>
            {s}
          </span>
        ))}
      </div>
      {job.state === 'confirmed' && (
        <div className="stack">
          <span className="badge ok">confirmed in block {job.blockHeight}</span>
          <div className="mono">tx {job.txId}</div>
          {job.flagIndex !== undefined && <div>flag index {job.flagIndex}</div>}
          {job.attKey && <div className="mono">attestation key {job.attKey}</div>}
          <div className="row">
            {job.links?.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
      {job.state === 'failed' && job.error && (
        <div>
          <span className={`badge ${DESIGNED_REFUSALS.has(job.error.code) ? 'warn' : 'bad'}`}>
            {DESIGNED_REFUSALS.has(job.error.code) ? 'refused as designed' : 'failed'}: {job.error.code}
          </span>
          <div className="muted">{job.error.message}</div>
          {!job.txId && <div className="muted">No transaction was submitted.</div>}
        </div>
      )}
    </div>
  );
}
