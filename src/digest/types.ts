export type DigestStatus = 'ok' | 'retry' | 'fail';

/** Raw valid-event totals, not counts of jobs or their final statuses. */
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** Events are ordered by timestamp, with file order breaking ties. */
export type DigestRow = {
  job: string;
  /** Owner from the last event; null means missing ownership. */
  owner: string | null;
  /** All valid events for this job, including retry and fail events. */
  runs: number;
  /** Number of retry events for this job. */
  retries: number;
  lastStatus: DigestStatus;
  /** Error from the last event, or null when that event has no error. */
  lastError: string | null;
  /** Earliest event's original timestamp string, including its offset. */
  firstAt: string;
  /** Latest event's original timestamp string, including its offset. */
  lastAt: string;
};

export type DigestNight = {
  night: string;
  /** One row per job, in ascending case-sensitive job-name order. */
  rows: DigestRow[];
  /** Nonblank lines rejected by JSON parsing or event validation. */
  badLines: number;
  counts: DigestCounts;
};

/**
 * Read runsDir/<night>.jsonl asynchronously. Only a missing file yields null;
 * other I/O errors reject. An existing empty file yields the requested night,
 * empty rows, zero badLines and zero counts. Blank lines are ignored.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<DigestNight | null>;