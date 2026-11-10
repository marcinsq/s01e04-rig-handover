import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60,
  runsDir: fileURLToPath(new URL('../runs/', import.meta.url)),
};
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('digest JSON', () => {
  it('returns the same jobs in the same order as the rendered page', async () => {
    const app = createApp(config);
    const json = await app.request('/api/digest/2026-10-28');
    const body = await json.json();
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    expect(body).toMatchObject({ night: '2026-10-28', badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    const pageJobs = [...html.matchAll(/<th scope="row">(.*?)<\/th>/g)].map(match => match[1]);
    expect(body.rows.map((row: { job: string }) => row.job)).toEqual(pageJobs);
  });

  it('answers 404 JSON for a night with no file and for an invalid night', async () => {
    const app = createApp(config);
    for (const night of ['2026-10-30', '../2026-10-28']) {
      const response = await app.request(`/api/digest/${encodeURIComponent(night)}`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'not found' });
    }
  });

  it('answers 200 with no rows for an empty night, matching the page', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-json-'));
    directories.push(runsDir);
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    const app = createApp({ ...config, runsDir });
    const response = await app.request('/api/digest/2026-10-28');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(await (await app.request('/digest/2026-10-28')).text()).toContain('nothing ran');
  });
});
