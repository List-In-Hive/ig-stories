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
let styles: unknown[] = [];
const visionRequests: unknown[] = [];
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
    responses: {
      parse: async (params: { text: { format: { name: string } }; input: unknown }) => {
        if (params.text.format.name !== 'brand_style')
          return { output_parsed: reviews.shift() ?? allPassed };
        visionRequests.push(params.input);
        return { output_parsed: styles.shift() };
      },
    },
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
  const scripts = stories
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
    .map((s) => s.version.data.script);
  assert.equal(new Set(scripts.map((s) => s.look)).size, 4, 'each story gets its own photo style');
  assert.deepEqual(
    scripts.map((s) => s.placement),
    ['top', 'bottom', 'top', 'bottom'],
  );
  assert.equal(requests[0].prompt.match(/Photo style:/g)?.length, 4);
  const bottom = stories.find((s) => s.version.data.script.placement === 'bottom')!;
  assert.ok(bottom.version.data.layout.headline.y > 900, 'bottom stories place text low');
});

test('the next plan avoids recent photo styles and scenes, and continues the text rhythm', async () => {
  const first = service.listStories().filter((s) => s.projectId === project.id)[0];
  requests.length = 0;
  replies = [
    { stories: ['Fresh angle', 'New corner', 'Another day', 'Last one'].map((t) => story(t)) },
  ];
  const runId = service.enqueueRun(project.id, 'manual', new Date(), 'live-run-variety');
  for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
  const prompt = requests[0].prompt;
  assert.match(prompt, /Recent image prompts/);
  assert.ok(prompt.includes(first.version.data.script.visual.slice(0, 40)));
  const before = new Set(
    service
      .listStories()
      .filter((s) => s.projectId === project.id && s.runId !== runId)
      .slice(0, 8)
      .map((s) => s.version.data.script.look),
  );
  const next = service.listStories().filter((s) => s.runId === runId);
  for (const s of next) assert.ok(!before.has(s.version.data.script.look), 'a fresh photo style');
});

test('the text wash is dark for brands with light text, so dark photos stay dark', async () => {
  const dark = await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: '#0e0e14' },
  })
    .composite([{ input: ai.wash('top', false) }])
    .raw()
    .toBuffer();
  const light = await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: '#0e0e14' },
  })
    .composite([{ input: ai.wash('top', true) }])
    .raw()
    .toBuffer();
  assert.ok(dark[0] < 20, 'a dark brand keeps its dark backdrop');
  assert.ok(light[0] > 100, 'a light wash brightens behind dark text');
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

test('regenerating with an admin prompt guides Claude and keeps the story design', async () => {
  let current = service.listStories().find((s) => s.projectId === project.id)!;
  const layout = structuredClone(current.version.data.layout);
  layout.headline = { ...layout.headline, color: '#ffffff', bold: false, size: 70 };
  const designed = service.saveStory(current.id, current.latestVersionId, layout, admin.id);

  requests.length = 0;
  replies = [{ stories: [story('Pumpkin latte')] }];
  const idea = await service.reviseStory(
    current.id,
    designed.id,
    'idea',
    admin.id,
    'Make it about our new pumpkin latte',
  );
  assert.match(requests[0].prompt, /Make it about our new pumpkin latte/);
  assert.equal(idea.data.script.topic, 'Pumpkin latte');
  assert.equal(idea.data.layout.headline.text, 'Pumpkin latte today');
  assert.equal(idea.data.layout.headline.color, '#ffffff', 'the admin design is kept');
  assert.equal(idea.data.layout.headline.size, 70);

  requests.length = 0;
  const images = imageCalls;
  replies = [{ visual: 'A pumpkin latte on a sunny windowsill' }];
  const image = await service.reviseStory(
    current.id,
    idea.id,
    'image',
    admin.id,
    'A latte on a sunny windowsill',
  );
  assert.match(requests[0].prompt, /A latte on a sunny windowsill/);
  assert.equal(imageCalls, images + 1);
  assert.equal(image.data.prompt, 'A pumpkin latte on a sunny windowsill');
  assert.equal(image.data.layout.headline.text, 'Pumpkin latte today');

  replies = [{ headline: 'Fall in a cup', body: 'Pumpkin spice is back.', cta: 'Try it today' }];
  const text = await service.reviseStory(current.id, image.id, 'text', admin.id, 'Shorter');
  assert.equal(text.data.layout.headline.text, 'Fall in a cup');
  assert.equal(text.data.layout.headline.color, '#ffffff');
  assert.equal(text.data.backgroundId, image.data.backgroundId, 'new text keeps the image');
  current = service.getStory(current.id);
  assert.equal(current.latestVersionId, text.id);
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
      industry:
        'Plants & home, including indoor plants, planters, workshops, plant care services, gifts and local delivery',
      description: 'A plant shop.',
      services: 'Indoor plants, Planters',
      audience: 'Plant lovers',
      facts: 'Open daily 9-7',
      rules: 'Warm, plain English.',
      prohibited: 'Medical claims',
      visualDirection: 'Soft greens',
      palette: { background: '#e6ebdf', text: '#1d2a1f', accent: '#638166', secondary: 'green' },
      font: 'Lora',
      email: 'see contact page',
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
  assert.equal(brief.colors.length, 4, 'invalid colors fall back to a full palette');
  assert.ok(brief.industry.length <= 80, 'long AI answers are shortened to fit the form');
  assert.match(brief.industry, /^Plants & home/);
  assert.equal(brief.email, '', 'an invalid AI email is dropped');
  const saved = service.saveProject({
    ...brief,
    status: 'paused',
    logoId: null,
    website: brief.website,
  });
  assert.equal(service.getProject(saved.id).instagram, 'https://www.instagram.com/fern/');
});

test('ChatGPT studies post photos while Claude researches, and hand-set styles are kept', async () => {
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
      description: 'A design studio in Yerevan.',
      services: 'Branding',
      audience: 'Founders',
      facts: 'Founded in 2019',
      rules: 'Confident and brief.',
      prohibited: 'Politics',
      visualDirection: 'Website guess',
      palette: { background: '#000000', text: '#ffffff', accent: '#111111', secondary: '#222222' },
      font: 'Inter',
      email: 'hi@shot.example',
      phone: '',
      address: '',
      location: 'Yerevan',
    },
  ];
  styles = [
    {
      visualDirection: 'Lilac minimal flat lays in soft daylight',
      palette: { background: '#ebe8f3', text: '#2b2540', accent: '#9d91b9', secondary: '#ded9e9' },
      font: 'Montserrat',
      themes: 'Desks, sketches',
      visibleFacts: 'Free consultation every Friday\nFounded in 2019',
      brandName: 'Shot',
      industry: '',
    },
  ];
  const photos = Array.from({ length: 20 }, () => shot);
  const brief = await ai.draftBrief({
    website: 'https://shot.example',
    instagram: '',
    photos,
  });
  // Claude gets text only; the 20 photos go to ChatGPT.
  assert.equal(typeof requests[0].prompt, 'string');
  assert.match(requests[0].prompt, /shot\.example/);
  const vision = visionRequests[0] as { content: { type: string }[] }[];
  assert.equal(vision[0].content.filter((b) => b.type === 'input_image').length, 20);
  assert.equal(brief.name, 'Shot Studio');
  assert.equal(brief.visualDirection, 'Lilac minimal flat lays in soft daylight');
  assert.deepEqual(brief.colors, ['#ebe8f3', '#2b2540', '#9d91b9', '#ded9e9']);
  assert.equal(brief.font, 'Montserrat');
  assert.equal(brief.facts, 'Founded in 2019\nFree consultation every Friday');
  assert.equal(brief.email, 'hi@shot.example');

  // Photos alone skip Claude, and styles set by hand win over both models.
  requests.length = 0;
  styles = [
    {
      visualDirection: 'From photos',
      palette: { background: '#ebe8f3', text: '#2b2540', accent: '#9d91b9', secondary: '#ded9e9' },
      font: 'Lora',
      themes: '',
      visibleFacts: '',
      brandName: 'Shot',
      industry: 'Design',
    },
  ];
  const kept = await ai.draftBrief({
    website: '',
    instagram: '',
    photos: [shot],
    keep: { colors: ['#f4f1ea', '#112233', '#445566', '#778899'], font: 'Brand' },
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(kept.colors, ['#f4f1ea', '#112233', '#445566', '#778899']);
  assert.equal(kept.font, 'Brand');
  assert.equal(kept.visualDirection, 'From photos');
  assert.equal(kept.name, 'Shot');
});

test('palette roles: old three-color brands gain a text color, and story text stays readable', async () => {
  const { normalizePalette, readable, contrast } = await import('../lib/palette');
  const composition = await import('../lib/composition');
  assert.deepEqual(normalizePalette(['#f5e8d7', '#a67550', '#ecdbc2']), [
    '#f5e8d7',
    '#172420',
    '#a67550',
    '#ecdbc2',
  ]);
  assert.equal(readable('#3b2a8f', '#f7f4ee'), '#3b2a8f');
  assert.ok(contrast(readable('#f0f0f0', '#ffffff'), '#ffffff') >= 4.5);
  const base = service.getProject(project.id);
  assert.equal(base.colors.length, 4);
  const branded = { ...base, colors: ['#f7f4ee', '#3b2a8f', '#c2410c', '#e9e2f5', '#0f766e'] };
  const layout = composition.defaultLayout(branded, story('Palette') as never);
  assert.equal(layout.headline.color, '#3b2a8f');
  assert.equal(layout.cta.color, '#c2410c');
  const saved = service.saveProject(branded, project.id);
  assert.equal(saved.colors.length, 5);
  service.saveProject({ ...saved, colors: base.colors }, project.id);
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
