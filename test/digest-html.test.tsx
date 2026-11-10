import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60,
  runsDir: fileURLToPath(new URL('../runs/', import.meta.url)),
};

afterEach(() => vi.unstubAllEnvs());

describe('digest HTML', () => {
  it('renders the expected night in the usual layout with complete sorted rows and warnings', async () => {
    vi.stubEnv('LANE_MARKER', 'DIGEST-HTML-TEST');
    const response = await createApp(config).request('/digest/2026-10-28');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('DIGEST-HTML-TEST');
    expect(html).toContain('bad lines: 1');
    expect(html.match(/<th scope="row">(.*?)<\/th>/g)).toEqual([
      '<th scope="row">digest/render</th>',
      '<th scope="row">fixtures/refresh</th>',
      '<th scope="row">lane/sync</th>',
      '<th scope="row">notes/backup</th>',
      '<th scope="row">rig/rotate-logs</th>',
    ]);
    expect(html).toContain('<td>\u2014</td><td>1</td><td>0</td><td>ok</td><td>\u2014</td>');
    expect(html).toContain('<td>rook</td><td>4</td><td><strong class="warn">3</strong></td>');
    expect(html).toContain('<td>lane-07</td><td>1</td><td>0</td><td><strong class="warn">fail</strong></td><td>quota exceeded</td>');
    expect(html).toContain('<td>2026-10-28T23:00:06+01:00</td><td>2026-10-29T05:00:04+01:00</td>');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).not.toContain('<script');
  });

  it('escapes job, owner and error text from the run log', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-html-'));
    try {
      await writeFile(join(runsDir, '2026-10-28.jsonl'), JSON.stringify({
        at: '2026-10-28T23:00:00+03:00', job: '<script>job</script>',
        owner: '<b>owner</b>', status: 'fail', error: '<img src=x onerror=alert(1)>',
      }));
      const response = await createApp({ ...config, runsDir }).request('/digest/2026-10-28');
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('&lt;script&gt;job&lt;/script&gt;');
      expect(html).toContain('&lt;b&gt;owner&lt;/b&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('2026-10-28T23:00:00+03:00');
      expect(html).not.toMatch(/<script|<img|<b>/);
    } finally {
      await rm(runsDir, { recursive: true, force: true });
    }
  });
});