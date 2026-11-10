import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const NIGHT = '2026-10-28';
const JOBS = ['Backup/nightly', 'digest/render', 'lane/sync'];

const NIGHT_LOG = [
  '{"at":"2026-10-28T23:00:00+01:00","job":"lane/sync","owner":"rook","status":"ok"}',
  '{"at":"2026-10-28T23:05:00+01:00","job":"digest/render","status":"retry"}',
  'not json',
  '{"at":"2026-10-28T23:06:00+01:00","job":"digest/render","status":"retry","error":"timeout"}',
  '',
  '{"at":"nope","job":"lane/sync","status":"ok"}',
  '{"at":"2026-10-28T23:07:00+01:00","job":"digest/render","status":"retry"}',
  '{"at":"2026-10-28T23:08:00-05:00","job":"Backup/nightly","owner":"rook","status":"fail","error":"quota exceeded"}',
].join('\n');

const directories: string[] = [];

async function temporaryRuns(nights: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'rig-routes-'));
  directories.push(directory);
  for (const [night, contents] of Object.entries(nights)) {
    await writeFile(join(directory, `${night}.jsonl`), contents);
  }
  return directory;
}

function configFor(runsDir: string) {
  return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
}

/** Text of each body cell, row by row, as a reader of the table sees it. */
function tableRows(html: string): string[][] {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, '')));
}

/** Highlighted cell texts (warn class) in page order. */
function highlighted(html: string): string[] {
  return [...html.matchAll(/<strong class="warn">(.*?)<\/strong>/g)].map(([, text]) => text);
}

type JsonRow = {
  job: string; owner: string | null; runs: number; retries: number;
  lastStatus: string; lastError: string | null; firstAt: string; lastAt: string;
};

function displayedCells(row: JsonRow): string[] {
  return [
    row.job, row.owner ?? '\u2014', String(row.runs), String(row.retries),
    row.lastStatus, row.lastError ?? '\u2014', row.firstAt, row.lastAt,
  ];
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('digest routes', () => {
  it('returns the same jobs, order and cell values on the page and in the JSON', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    const page = await app.request(`/digest/${NIGHT}`);
    const json = await app.request(`/api/digest/${NIGHT}`);
    const html = await page.text();
    const body = await json.json() as { rows: JsonRow[]; badLines: number; counts: object };

    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(body.rows.map(row => row.job)).toEqual(JOBS);
    expect(tableRows(html).map(cells => cells[0])).toEqual(JOBS);
    expect(tableRows(html)).toEqual(body.rows.map(displayedCells));
    expect(body).toMatchObject({ badLines: 2, counts: { ok: 1, retry: 3, fail: 1 } });
  });

  it('answers 404 on both routes for a night with no file', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    expect((await app.request('/digest/2026-10-30')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-30')).status).toBe(404);
  });

  it('answers 200 with nothing ran and no rows for an empty night on both routes', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: '' })));
    const page = await app.request(`/digest/${NIGHT}`);
    const html = await page.text();
    const json = await app.request(`/api/digest/${NIGHT}`);

    expect(page.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night: NIGHT, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps the night and counts malformed lines on both routes', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    const body = await (await app.request(`/api/digest/${NIGHT}`)).json() as { badLines: number; rows: JsonRow[] };

    expect(html).toContain('bad lines: 2');
    expect(body.badLines).toBe(2);
    expect(tableRows(html)).toHaveLength(3);
    expect(body.rows).toHaveLength(3);
  });

  it('shows a null owner as an em dash on the page and null in the JSON', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    const body = await (await app.request(`/api/digest/${NIGHT}`)).json() as { rows: JsonRow[] };

    const digest = body.rows.find(row => row.job === 'digest/render');
    expect(digest?.owner).toBeNull();
    const cells = tableRows(html).find(row => row[0] === 'digest/render');
    expect(cells?.[1]).toBe('\u2014');
  });

  it('highlights a fail and retries of 3 or more, and nothing below the threshold', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    const html = await (await app.request(`/digest/${NIGHT}`)).text();

    expect(highlighted(html)).toEqual(['fail', '3']);
    expect(tableRows(html).find(row => row[0] === 'lane/sync')?.[3]).toBe('0');
  });

  it('keeps timestamp offsets as written on both routes', async () => {
    const app = createApp(configFor(await temporaryRuns({ [NIGHT]: NIGHT_LOG })));
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    const body = await (await app.request(`/api/digest/${NIGHT}`)).json() as { rows: JsonRow[] };

    const backup = body.rows.find(row => row.job === 'Backup/nightly');
    expect(backup?.firstAt).toBe('2026-10-28T23:08:00-05:00');
    expect(backup?.lastAt).toBe('2026-10-28T23:08:00-05:00');
    expect(html).toContain('<td>2026-10-28T23:08:00-05:00</td><td>2026-10-28T23:08:00-05:00</td>');
    expect(html).not.toMatch(/\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
  });

  it('links each night on the board to a digest that renders with the same counts', async () => {
    const runsDir = await temporaryRuns({ [NIGHT]: NIGHT_LOG, '2026-10-27': '' });
    const app = createApp(configFor(runsDir));
    const board = await (await app.request('/')).text();
    const hrefs = [...board.matchAll(/href="(\/digest\/[^"]+)"/g)].map(([, href]) => href);

    expect(hrefs).toEqual([`/digest/${NIGHT}`, '/digest/2026-10-27']);
    expect(board).toContain('ok 1 · retry 3 · fail 1');
    for (const href of hrefs) {
      const response = await app.request(href);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`digest ${href.slice('/digest/'.length)}`);
    }
  });
});
