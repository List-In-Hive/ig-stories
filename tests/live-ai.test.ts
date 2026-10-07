import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-live-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  ANTHROPIC_API_KEY: 'test-key',
  OPENAI_API_KEY: 'test-key',
});
const { seed } = await import('../lib/seed');
const store = await import('../lib/db');
const service = await import('../lib/services');
const ai = await import('../lib/ai');
await seed();
const admin = store.one<{ id: string }>("SELECT id FROM users WHERE role='admin'")!;

const story = (topic: string, kind = 'standard') => ({
  kind,
  topic,
  headline: `${topic} today`,
  body: 'Seasonal coffee and freshly baked pastries are part of our menu.',
  cta: 'Visit us this week',
  visual: `A calm morning scene about ${topic}`,
});
const requests: { prompt: string }[] = [];
let replies: unknown[] = [];
const png = await sharp({
  create: { width: 1024, height: 1536, channels: 3, background: '#c28660' },
})
  .png()
  .toBuffer();
let imageCalls = 0;
ai.setLiveClients({
  anthropic: {
    beta: {
      messages: {
        parse: async (params: { messages: { content: string }[] }) => {
          requests.push({ prompt: params.messages[0].content });
          return { stop_reason: 'end_turn', parsed_output: replies.shift() };
        },
      },
    },
  } as never,
  openai: {
    images: {
      generate: async () => {
        imageCalls++;
        return { data: [{ b64_json: png.toString('base64') }] };
      },
    },
  } as never,
});
const project = service.listProjects()[0];

test('live mode plans four distinct Claude scripts per run and paints OpenAI backgrounds', async () => {
  store.setSetting('providerMode', 'live');
  replies = [
    {
      stories: ['Slow mornings', 'Pastry craft', 'Seasonal cup', 'Our space'].map((t) => story(t)),
    },
  ];
  const runId = service.enqueueRun(project.id, 'manual', new Date(), 'live-run-four-slots');
  for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
  const stories = service.listStories().filter((s) => s.runId === runId);
  assert.equal(stories.length, 4);
  assert.equal(requests.length, 1, 'one Claude call plans the whole run');
  assert.equal(imageCalls, 4);
  assert.equal(new Set(stories.map((s) => s.version.data.script.topic)).size, 4);
  for (const s of stories) {
    assert.equal(s.version.data.provider, 'live');
    const bg = await sharp(
      fs.readFileSync(
        path.join(
          store.dataDir,
          'assets',
          store.one<{ filename: string }>(
            'SELECT filename FROM assets WHERE id=?',
            s.version.data.backgroundId,
          )!.filename,
        ),
      ),
    ).metadata();
    assert.deepEqual([bg.width, bg.height, bg.format], [1080, 1920, 'png']);
  }
});

test('live scripts that break the engagement rule are retried with the reason', async () => {
  assert.equal(project.allowEngagement, false);
  requests.length = 0;
  replies = [
    { stories: [story('Asking', 'question'), story('B'), story('C'), story('D')] },
    { stories: ['E', 'F', 'G', 'H'].map((t) => story(t)) },
  ];
  const runId = service.enqueueRun(project.id, 'manual', new Date(), 'live-run-engagement');
  await service.processJob(service.claimJob()!);
  assert.equal(requests.length, 2);
  assert.match(requests[1].prompt, /previous attempt was rejected/);
  assert.equal(service.listStories().filter((s) => s.runId === runId).length, 1);
  for (let i = 0; i < 3; i++) await service.processJob(service.claimJob()!);
});

test('live text feedback is rewritten by Claude as a new draft', async () => {
  const current = service.listStories().find((s) => s.projectId === project.id)!;
  replies = [{ headline: 'Warm cups', body: 'Freshly baked pastries.', cta: 'Stop by' }];
  const result = await service.requestChanges(
    current.id,
    current.latestVersionId,
    'text',
    'Make it shorter and warmer',
    admin.id,
  );
  assert.equal(result.applied, true);
  const next = service.getStory(current.id);
  assert.equal(next.version.data.layout.headline.text, 'Warm cups');
  assert.equal(next.version.data.script.cta, 'Stop by');
});

test('live mode without API keys fails clearly instead of falling back to demo', async () => {
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(service.makeSnapshot(project, 1, 1), /OPENAI_API_KEY/);
  process.env.OPENAI_API_KEY = key;
  store.setSetting('providerMode', 'demo');
});

test('each project generates at its own time in the workspace time zone', async () => {
  const schedule = await import('../lib/schedule');
  store.setSetting('timeZone', 'Asia/Yerevan');
  assert.equal(
    schedule.scheduledAt('2031-06-10', '09:30').toISOString(),
    '2031-06-10T05:30:00.000Z',
  );
  // 02:30 does not exist on the US spring-forward date; it resolves to 03:00.
  store.setSetting('timeZone', 'America/New_York');
  assert.equal(
    schedule.scheduledAt('2031-03-09', '02:30').toISOString(),
    '2031-03-09T07:00:00.000Z',
  );
  store.setSetting('timeZone', 'Asia/Yerevan');
  const [early, late] = service.listProjects().filter((p) => p.status === 'active');
  service.saveProject({ ...early, generateAt: '07:00' }, early.id);
  service.saveProject({ ...late, generateAt: '11:00' }, late.id);
  const runsOn = (date: string) =>
    store
      .query<{ projectId: string }>(
        "SELECT projectId FROM runs WHERE businessDate=? AND kind='scheduled'",
        date,
      )
      .map((r) => r.projectId);
  store.setSetting('automationEnabled', 'true');
  service.dailyBatch(new Date('2031-06-10T04:00:00Z'), true); // 08:00 Yerevan
  assert.ok(runsOn('2031-06-10').includes(early.id));
  assert.ok(!runsOn('2031-06-10').includes(late.id));
  service.dailyBatch(new Date('2031-06-10T07:00:00Z'), true); // 11:00 Yerevan
  assert.ok(runsOn('2031-06-10').includes(late.id));
  assert.equal(
    schedule.nextRun(new Date('2031-06-10T04:00:00Z'), ['07:00', '11:00']),
    '2031-06-10T07:00:00.000Z',
  );
  store.setSetting('timeZone', 'America/Los_Angeles');
});
