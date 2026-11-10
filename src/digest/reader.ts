import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestNight, DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner?: string | null;
  error?: string | null;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'at' in value && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at))
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && (!('owner' in value) || value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || value.error === null || typeof value.error === 'string');
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const nightTime = Date.parse(night);
  if (!Number.isFinite(nightTime) || new Date(nightTime).toISOString().slice(0, 10) !== night) return null;

  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const result: DigestNight = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; firstTime: number; lastTime: number }>();
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      result.badLines++;
      continue;
    }
    if (!isRunEvent(event)) {
      result.badLines++;
      continue;
    }

    result.counts[event.status]++;
    const time = Date.parse(event.at);
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner ?? null,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: time,
        lastTime: time,
      });
      continue;
    }

    existing.row.runs++;
    if (event.status === 'retry') existing.row.retries++;
    if (time < existing.firstTime) {
      existing.firstTime = time;
      existing.row.firstAt = event.at;
    }
    if (time >= existing.lastTime) {
      existing.lastTime = time;
      existing.row.lastAt = event.at;
      existing.row.lastStatus = event.status;
      existing.row.owner = event.owner ?? null;
      existing.row.lastError = event.error ?? null;
    }
  }

  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return result;
};