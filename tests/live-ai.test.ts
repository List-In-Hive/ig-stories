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
  sources: [] as string[],
});
const requests: { prompt: string }[] = [];
let replies: unknown[] = [];
let searchResults: string[] = [];
let reviews: unknown[] = [];
const allPassed = { reviews: [0, 1, 2, 3].map((index) => ({ index, passed: true, issues: [] })) };
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
          const content = searchResults.length
            ? [
                {
                  type: 'web_search_tool_result',
                  content: searchResults.map((url) => ({ url, title: url })),
                },
              ]
            : [];
          searchResults = [];
          return { stop_reason: 'end_turn', content, parsed_output: replies.shift() };
        },
      },
    },
  } as never,
  openai: {
    responses: { parse: async () => ({ output_parsed: reviews.shift() ?? allPassed }) },
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

test('Claude researches, ChatGPT reviews, and flagged stories are revised once', async () => {
  store.setSetting('providerMode', 'live');
  requests.length = 0;
  searchResults = ['https://example.com/autumn-menu'];
  const researched = {
    ...story('Autumn hook'),
    sources: ['https://example.com/autumn-menu', 'https://invented.example/not-searched'],
  };
  replies = [
    { stories: [researched, story('Tip'), story('Product'), story('Moment')] },
    { headline: 'Pastry, slowly', body: 'Freshly baked pastries.', cta: 'Visit us' },
  ];
  reviews = [
    {
      reviews: [
        { index: 0, passed: true, issues: [] },
        { index: 1, passed: false, issues: ['The headline is generic.'] },
        { index: 2, passed: true, issues: [] },
        { index: 3, passed: true, issues: [] },
      ],
    },
  ];
  const runId = service.enqueueRun(project.id, 'manual', new Date(), 'live-run-review');
  for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
  assert.match(requests[0].prompt, /Today is /);
  assert.match(requests[0].prompt, /web search/);
  assert.match(requests[1].prompt, /The headline is generic/);
  const scripts = service
    .listStories()
    .filter((s) => s.runId === runId)
    .map((s) => s.version.data.script)
    .sort((a, b) => a.topic.localeCompare(b.topic));
  const hook = scripts.find((s) => s.topic === 'Autumn hook')!;
  assert.deepEqual(hook.sources, ['https://example.com/autumn-menu']);
  const tip = scripts.find((s) => s.topic === 'Tip')!;
  assert.equal(tip.headline, 'Pastry, slowly');
  assert.deepEqual(tip.review, {
    reviewer: ai.OPENAI_REVIEW_MODEL,
    passed: false,
    notes: ['The headline is generic.'],
    revised: true,
  });
  store.setSetting('providerMode', 'demo');
});

test('approvals and feedback are remembered for the next plan', async () => {
  const draft = service
    .listStories()
    .find((s) => s.projectId === project.id && !s.approvedVersionId)!;
  service.approve([{ storyId: draft.id, versionId: draft.latestVersionId }], admin.id);
  const approved = JSON.parse(store.setting(`taste:approved:${project.id}`, '[]'));
  assert.equal(
    approved[0],
    `${draft.version.data.script.topic}: ${draft.version.data.script.headline}`,
  );
  assert.match(store.setting(`taste:feedback:${project.id}`, '[]'), /Make it shorter and warmer/);
});

test('ADMIN_PASSWORD replaces the stored password once and signs out old sessions', async () => {
  const auth = await import('../lib/auth');
  const before = auth.localAuth.signIn('admin', '9741faso');
  assert.throws(() => auth.syncAdminPassword('short'), /12 to 72/);
  assert.equal(auth.syncAdminPassword('a much longer password'), true);
  assert.equal(auth.syncAdminPassword('a much longer password'), false);
  assert.equal(auth.localAuth.session(before.token), null);
  assert.throws(() => auth.localAuth.signIn('admin', '9741faso'));
  assert.ok(auth.localAuth.signIn('admin', 'a much longer password').token);
});

test('AI quick start drafts a brief from the website for review', async () => {
  requests.length = 0;
  replies = [
    {
      name: 'Fern & Field',
      industry: 'Plants & home',
      description: 'A plant shop.',
      services: 'Indoor plants, Planters',
      audience: 'Plant lovers',
      facts: 'Open daily 9-7',
      rules: 'Warm, plain English.',
      prohibited: 'Medical claims',
      visualDirection: 'Soft greens',
      colors: ['#e6ebdf', '#638166', 'green'],
      font: 'Lora',
      email: '',
      phone: '',
      address: '',
      location: 'Yerevan',
    },
  ];
  const brief = await ai.draftBrief({
    website: 'https://fern.example',
    instagram: 'https://www.instagram.com/fern/',
  });
  assert.match(requests[0].prompt, /https:\/\/fern\.example/);
  assert.equal(brief.colors.length, 3, 'invalid colors fall back to a full palette');
  const saved = service.saveProject({
    ...brief,
    status: 'paused',
    logoId: null,
    website: brief.website,
  });
  assert.equal(service.getProject(saved.id).instagram, 'https://www.instagram.com/fern/');
});

test('post photos are cleaned and sent to Claude, and hand-set styles are kept', async () => {
  const storage = await import('../lib/storage');
  await assert.rejects(storage.normalizePhoto('bm90IGFuIGltYWdl'), /could not be read/);
  const tall = await sharp({
    create: { width: 1170, height: 2532, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  const shot = await storage.normalizePhoto(`data:image/png;base64,${tall.toString('base64')}`);
  const meta = await sharp(shot).metadata();
  assert.deepEqual([meta.format, meta.height! <= 1280], ['jpeg', true]);
  requests.length = 0;
  replies = [
    {
      name: 'Shot Studio',
      industry: 'Design',
      description: 'A studio.',
      services: '',
      audience: '',
      facts: '',
      rules: '',
      prohibited: '',
      visualDirection: 'Lilac minimal',
      colors: ['#ebe8f3', '#9d91b9', '#ded9e9'],
      font: 'Inter',
      email: '',
      phone: '',
      address: '',
      location: '',
    },
  ];
  const brief = await ai.draftBrief({
    website: '',
    instagram: '',
    photos: [shot, shot],
    keep: { colors: ['#112233', '#445566', '#778899'], font: 'Brand' },
  });
  const content = requests[0].prompt as unknown as { type: string; text?: string }[];
  assert.deepEqual(
    content.map((b) => b.type),
    ['image', 'image', 'text'],
  );
  assert.match(content[2].text!, /already set the brand colors #112233, #445566, #778899/);
  assert.deepEqual(brief.colors, ['#112233', '#445566', '#778899']);
  assert.equal(brief.font, 'Brand');
  assert.equal(brief.visualDirection, 'Lilac minimal');
});

test('an uploaded brand font is validated, frozen into stories, and used for rendering', async () => {
  const storage = await import('../lib/storage');
  const composition = await import('../lib/composition');
  assert.throws(() => storage.uploadFont(Buffer.from('not a font at all')), /\.ttf or \.otf/);
  const bytes = fs.readFileSync(path.join(process.cwd(), 'public/fonts/Montserrat-ExtraBold.ttf'));
  const regular = storage.uploadFont(bytes);
  assert.equal(regular.family, 'Montserrat ExtraBold');
  const base = service.getProject(project.id);
  const draft = { ...base, font: 'Brand', brandFont: null };
  assert.throws(() => service.saveProject(draft, project.id), /Upload a brand font/);
  const saved = service.saveProject(
    {
      ...draft,
      // A wrong family from the browser is replaced by the name inside the file.
      brandFont: { name: 'Fern Display', regular: { ...regular, family: 'Spoofed' }, bold: null },
    },
    project.id,
  );
  assert.equal(saved.brandFont!.regular.family, 'Montserrat ExtraBold');
  store.setSetting('providerMode', 'demo');
  const made = await service.createManual(project.id, story('Brand type'), admin.id, 'brand-font');
  const snapshot = made.version.data;
  assert.equal(snapshot.fontAssets!.Brand, regular.id);
  assert.equal(snapshot.layout.headline.font, 'Brand');
  assert.match(composition.renderSvg(snapshot), /font-family="Montserrat ExtraBold"/);
  const branded = composition.renderPng(snapshot);
  const plain = structuredClone(snapshot);
  for (const key of ['headline', 'body', 'cta', 'contact'] as const)
    plain.layout[key].font = 'Inter';
  assert.notDeepEqual(branded, composition.renderPng(plain));
  service.saveProject({ ...saved, font: 'Inter', brandFont: null }, project.id);
});
