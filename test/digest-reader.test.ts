import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const directories: string[] = [];

async function temporaryRuns(contents?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'rig-reader-'));
  directories.push(directory);
  if (contents !== undefined) await writeFile(join(directory, `${night}.jsonl`), contents);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('run log reader', () => {
  it('reads the real night without dropping unowned jobs or counting only final statuses', async () => {
    const result = await readNight(fileURLToPath(new URL('../runs/', import.meta.url)), night);
    expect(result).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('distinguishes missing files from empty files and ignores CRLF blank lines', async () => {
    const directory = await temporaryRuns();
    expect(await readNight(directory, night)).toBeNull();
    for (const contents of ['', '\r\n  \r\n\t\n']) {
      await writeFile(join(directory, `${night}.jsonl`), contents);
      expect(await readNight(directory, night)).toEqual({
        night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it('counts each malformed or invalid nonblank line and accepts missing ownership', async () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok' };
    const invalid = [null, [], 42, 'text', {},
      { ...valid, at: 'invalid' }, { ...valid, at: 123 },
      { ...valid, job: ' ' }, { ...valid, job: null },
      { ...valid, status: 'unknown' }, { ...valid, owner: 123 }, { ...valid, error: false }];
    const directory = await temporaryRuns([
      '{broken', ...invalid.map(value => JSON.stringify(value)), '', '  ', JSON.stringify(valid),
    ].join('\r\n'));
    const result = await readNight(directory, night);
    expect(result?.badLines).toBe(invalid.length + 1);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result?.rows).toEqual([{ job: 'job', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null, firstAt: valid.at, lastAt: valid.at }]);
  });

  it('orders by parsed time, preserves offsets, and breaks ties by file position', async () => {
    const events = [
      { at: '2026-10-29T01:00:00+01:00', job: 'a', status: 'fail', owner: 'latest', error: 'latest error' },
      { at: '2026-10-29T02:00:00+03:00', job: 'a', status: 'retry', owner: 'earlier', error: 'old error' },
      { at: '2026-10-28T23:00:00Z', job: 'a', status: 'ok', owner: null },
      { at: '2026-10-29T02:00:00+02:00', job: 'a', status: 'ok' },
      { at: '2026-10-29T00:00:00+02:00', job: 'a', status: 'retry', owner: 'oldest' },
      { at: '2026-10-28T23:00:00Z', job: 'Z', status: 'fail', owner: null, error: null },
      { at: '2026-10-28T23:00:00Z', job: 'A', status: 'ok', owner: 'owner' },
    ];
    const directory = await temporaryRuns(events.map(event => JSON.stringify(event)).join('\r\n'));
    const result = await readNight(directory, night);
    expect(result?.rows.map(row => row.job)).toEqual(['A', 'Z', 'a']);
    expect(result?.rows[2]).toEqual({ job: 'a', owner: null, runs: 5, retries: 2,
      lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T00:00:00+02:00', lastAt: '2026-10-29T02:00:00+02:00' });
    expect(result?.counts).toEqual({ ok: 3, retry: 2, fail: 2 });
    expect(result?.badLines).toBe(0);
  });

  it('rejects invalid nights and traversal before reading, but propagates other I/O errors', async () => {
    const directory = await temporaryRuns();
    await mkdir(join(directory, `${night}.jsonl`));
    for (const invalid of ['../2026-10-28', '..\\2026-10-28', '/2026-10-28',
      '2026-10-28/../2026-10-28', '2026-1-01', '2026-02-30', '2026-13-01', `${night}\n`]) {
      expect(await readNight(directory, invalid)).toBeNull();
    }
    await expect(readNight(directory, night)).rejects.toHaveProperty('code', 'EISDIR');
  });
});