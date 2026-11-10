import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.notFound();
    return c.html(
      <Layout title={`digest ${digest.night}`} lane={lane()}>
        <Digest digest={digest} />
      </Layout>,
    );
  });

  app.get('/api/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.json({ error: 'not found' }, 404);
    return c.json(digest);
  });

  app.get('/', async (c) => {
    const status = readStatus(config);
    const nights = await Promise.all(
      status.nights.map(async (night) => ({
        night,
        counts: (await readNight(config.runsDir, night))?.counts ?? null,
      })),
    );
    return c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={status} nights={nights} />
      </Layout>,
    );
  });

  return app;
}
