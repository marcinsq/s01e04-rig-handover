import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';

const directories: string[] = [];

async function temporaryRuns(nights: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'rig-board-'));
  directories.push(directory);
  for (const [night, contents] of Object.entries(nights)) {
    await writeFile(join(directory, `${night}.jsonl`), contents);
  }
  return directory;
}

function configFor(runsDir: string) {
  return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('status board night links', () => {
  it('links each night on disk to its digest with the counts read by the reader', async () => {
    const runsDir = await temporaryRuns({
      '2026-10-27': [
        '{"at":"2026-10-27T23:00:00+01:00","job":"a","status":"ok"}',
        '{"at":"2026-10-27T23:10:00+01:00","job":"a","status":"retry"}',
      ].join('\n'),
      '2026-10-28': [
        '{"at":"2026-10-28T23:00:00+01:00","job":"b","status":"fail","error":"quota"}',
        '{"at":"2026-10-28T23:01:00+01:00","job":"b","status":"fail"}',
        'not json',
      ].join('\n'),
    });

    const res = await createApp(configFor(runsDir)).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 1 · retry 1 · fail 0');
    expect(html).toContain('ok 0 · retry 0 · fail 2');

    for (const night of ['2026-10-27', '2026-10-28']) {
      const digest = await readNight(runsDir, night);
      expect(digest).not.toBeNull();
      const { ok, retry, fail } = digest!.counts;
      expect(html).toContain(`ok ${ok} · retry ${retry} · fail ${fail}`);
    }
  });

  it('shows the empty state when runs/ has no nights', async () => {
    const runsDir = await temporaryRuns({});
    const html = await (await createApp(configFor(runsDir)).request('/')).text();
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });
});
