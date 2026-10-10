import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import JSZip from 'jszip';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-tests-'));
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.WORKER_MAX_ATTEMPTS = '3';
const { seed } = await import('../lib/seed');
const store = await import('../lib/db');
const service = await import('../lib/services');
const auth = await import('../lib/auth');
const schedule = await import('../lib/schedule');
const composition = await import('../lib/composition');
const storage = await import('../lib/storage');
const { AppError } = await import('../lib/errors');
await seed();
test('concurrent app processes initialize and migrate one empty database safely', async () => {
  const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-concurrent-'));
  const execute = promisify(execFile);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      execute(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', "await import('./lib/db.ts')"],
        { cwd: process.cwd(), env: { ...process.env, DATA_DIR: sharedDir } },
      ),
    ),
  );
  const connection = new DatabaseSync(path.join(sharedDir, 'storyloom.sqlite'));
  assert.equal(
    (connection.prepare('SELECT count(*) AS count FROM migrations').get() as { count: number })
      .count,
    5,
  );
  connection.close();
});
const admin = store.one<{ id: string }>("SELECT id FROM users WHERE role='admin'")!;
const initialProject = service.listProjects()[0];
let chosenStory = service
  .listStories()
  .find((s) => s.projectId === initialProject.id && !s.approvedVersionId)!;
test('SQLite migrations, repeatable seed, foreign keys, and persisted data', async () => {
  const count = service.listProjects().length;
  await seed();
  assert.equal(service.listProjects().length, count);
  assert.throws(() =>
    store.run('INSERT INTO sessions VALUES(?,?,?)', 'invalid', 'missing', '2099-01-01'),
  );
  const reopened = new DatabaseSync(path.join(process.env.DATA_DIR!, 'storyloom.sqlite'));
  assert.equal(
    (reopened.prepare('SELECT count(*) AS n FROM projects').get() as { n: number }).n,
    3,
  );
  reopened.close();
});
test('single admin username login, hashed password, sessions, and rejected legacy access', () => {
  const raw = store.one<{ passwordHash: string }>(
    'SELECT passwordHash FROM users WHERE id=?',
    admin.id,
  )!;
  assert.match(raw.passwordHash, /^\$2/);
  assert.equal(store.query('SELECT id FROM users WHERE active=1').length, 1);
  const session = auth.localAuth.signIn(' ADMIN ', '9741faso');
  assert.equal(session.user.username, 'admin');
  assert.equal(auth.localAuth.session(session.token)?.role, 'admin');
  assert.equal(auth.localAuth.session('fake'), null);
  Object.assign(process.env, { NODE_ENV: 'production', LOCAL_DEMO_ACCESS: 'false' });
  assert.equal(auth.localAuth.session(session.token)?.username, 'admin');
  Object.assign(process.env, { NODE_ENV: 'test' });
  for (const username of ['admin@storyloom.local', 'pm@storyloom.local', 'manager'])
    assert.throws(() => auth.localAuth.signIn(username, 'StoryloomDev!2026'));
  assert.throws(() => auth.localAuth.signIn('admin', 'wrong'));
  assert.throws(() => store.run("UPDATE users SET role='pm' WHERE id=?", admin.id));
  assert.throws(() => store.run("UPDATE users SET username='manager' WHERE id=?", admin.id));
  store.run(
    'UPDATE sessions SET expiresAt=? WHERE tokenHash=?',
    '2000-01-01',
    auth.tokenDigest(session.token),
  );
  assert.equal(auth.localAuth.session(session.token), null);
  store.run('UPDATE users SET active=0 WHERE id=?', admin.id);
  assert.throws(() => auth.localAuth.signIn('admin', '9741faso'));
  store.run('UPDATE users SET active=1 WHERE id=?', admin.id);
  for (let i = 0; i < 8; i++) assert.throws(() => auth.localAuth.signIn('admin', 'wrong'));
  assert.throws(
    () => auth.localAuth.signIn('admin', '9741faso'),
    (e: unknown) => e instanceof AppError && e.status === 429,
  );
  store.run("DELETE FROM login_attempts WHERE username='admin'");
  assert.equal(auth.localAuth.signIn('admin', '9741faso').user.id, admin.id);
});
test('single-admin migration preserves story authors and approvals and revokes old access once', async () => {
  const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-legacy-'));
  const connection = new DatabaseSync(path.join(sharedDir, 'storyloom.sqlite'));
  connection.exec('PRAGMA foreign_keys=ON');
  for (const name of ['001_initial.sql', '002_planned_scripts.sql', '003_auth_attempts.sql']) {
    connection.exec(fs.readFileSync(path.join('migrations', name), 'utf8'));
    connection.prepare('INSERT INTO migrations VALUES(?,?)').run(name, '2026-01-01');
  }
  connection
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
    .run('legacy-admin', 'Alex', 'admin@storyloom.local', 'old-hash', 'admin', 1, '2026-01-01');
  connection
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
    .run('legacy-pm', 'Jamie', 'pm@storyloom.local', 'old-hash', 'pm', 1, '2026-01-01');
  connection
    .prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)')
    .run('legacy-project', 'Brand', 'Design', 'active', '{}', '2026-01-01', '2026-01-01');
  connection
    .prepare('INSERT INTO stories VALUES(?,?,?,?,?,?,?)')
    .run('legacy-story', 'legacy-project', null, null, '2026-01-01', null, '2026-01-01');
  connection
    .prepare('INSERT INTO story_versions VALUES(?,?,?,?,?,?)')
    .run('legacy-version', 'legacy-story', 1, '{}', 'legacy-pm', '2026-01-01');
  connection
    .prepare('UPDATE stories SET latestVersionId=? WHERE id=?')
    .run('legacy-version', 'legacy-story');
  connection
    .prepare('INSERT INTO approvals VALUES(?,?,?,?,?)')
    .run('legacy-approval', 'legacy-story', 'legacy-version', 'legacy-admin', '2026-01-01');
  connection
    .prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run('old-session', 'legacy-pm', '2099-01-01');
  connection
    .prepare('INSERT INTO tokens VALUES(?,?,?,?,?)')
    .run('old-reset', 'legacy-admin', 'reset', '2099-01-01', null);
  const execute = promisify(execFile);
  const migrate = () =>
    execute(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./lib/db.ts')"],
      { cwd: process.cwd(), env: { ...process.env, DATA_DIR: sharedDir } },
    );
  await migrate();
  const active = connection.prepare('SELECT * FROM users WHERE active=1').get() as {
    id: string;
    username: string;
    passwordHash: string;
  };
  assert.equal(active.id, 'legacy-admin');
  assert.equal(active.username, 'admin');
  const { compareSync } = await import('bcryptjs');
  assert.ok(compareSync('9741faso', active.passwordHash));
  assert.equal(
    (
      connection.prepare("SELECT active FROM users WHERE id='legacy-pm'").get() as {
        active: number;
      }
    ).active,
    0,
  );
  assert.equal(
    (
      connection
        .prepare("SELECT createdBy FROM story_versions WHERE id='legacy-version'")
        .get() as { createdBy: string }
    ).createdBy,
    'legacy-pm',
  );
  assert.equal(
    (
      connection.prepare("SELECT reviewerId FROM approvals WHERE id='legacy-approval'").get() as {
        reviewerId: string;
      }
    ).reviewerId,
    'legacy-admin',
  );
  assert.equal(connection.prepare('SELECT * FROM sessions').all().length, 0);
  assert.ok(
    (connection.prepare('SELECT consumedAt FROM tokens').get() as { consumedAt: string })
      .consumedAt,
  );
  assert.throws(() => connection.prepare("UPDATE users SET active=1 WHERE id='legacy-pm'").run());
  connection
    .prepare("UPDATE users SET passwordHash='replacement-hash' WHERE id='legacy-admin'")
    .run();
  await migrate();
  assert.equal(
    (
      connection.prepare("SELECT passwordHash FROM users WHERE id='legacy-admin'").get() as {
        passwordHash: string;
      }
    ).passwordHash,
    'replacement-hash',
  );
  assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);
  connection.close();
});
test('project CRUD, validated logo upload, current settings survive another connection', async () => {
  const bytes = await sharp({
    create: { width: 240, height: 80, channels: 4, background: '#973abd' },
  })
    .png()
    .toBuffer();
  const logoId = await storage.uploadLogo(bytes, 'image/png');
  assert.equal(storage.localStorage.read(logoId).width, 240);
  await assert.rejects(storage.uploadLogo(Buffer.from('invalid'), 'image/svg+xml'));
  await assert.rejects(
    storage.uploadLogo(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
      'image/png',
    ),
  );
  const saved = service.saveProject({
    ...initialProject,
    name: 'Local Test Studio',
    logoId,
    instagram: 'https://www.instagram.com/fictional_studio/',
    facts: 'We create thoughtful local test designs.',
  });
  const changed = service.saveProject({ ...saved, audience: 'Updated test audience' }, saved.id);
  assert.equal(service.getProject(saved.id).audience, changed.audience);
  assert.throws(() => service.saveProject({ ...saved, instagram: 'https://example.com/invalid' }));
  service.saveProject({ ...changed, status: 'archived' }, saved.id);
  assert.equal(service.getProject(saved.id).status, 'archived');
  service.saveProject({ ...changed, status: 'paused' }, saved.id);
});
test('four independent drafts, isolated unavailable research, and manual duplicate protection', async () => {
  const runId = service.enqueueRun(
    initialProject.id,
    'manual',
    new Date(),
    'test-manual-four-slots',
  );
  assert.equal(
    service.enqueueRun(initialProject.id, 'manual', new Date(), 'test-manual-four-slots'),
    runId,
  );
  for (let i = 0; i < 4; i++) {
    const job = service.claimJob()!;
    assert.ok(job);
    await service.processJob(job);
  }
  const stories = service.listStories().filter((s) => s.runId === runId);
  assert.equal(stories.length, 4);
  assert.equal(new Set(stories.map((s) => s.version.data.script.topic)).size, 4);
  assert.equal(new Set(stories.map((s) => s.version.data.backgroundId)).size, 4);
  assert.equal(
    stories.every((s) => s.version.data.script.sources.length === 0),
    true,
  );
  assert.ok(
    store.query(
      "SELECT id FROM research WHERE projectId=? AND status='unavailable'",
      initialProject.id,
    ).length >= 4,
  );
  chosenStory = stories[0];
});
test('text edit never invokes image provider, exact approvals and immutable versions', () => {
  const original = chosenStory.version;
  const before = store.setting('demoImageOperations', '0');
  const layout = structuredClone(original.data.layout);
  layout.headline.text = 'My exact edited headline';
  const saved = service.saveStory(chosenStory.id, original.id, layout, admin.id);
  assert.equal(saved.data.backgroundId, original.data.backgroundId);
  assert.equal(store.setting('demoImageOperations', '0'), before);
  service.approve([{ storyId: chosenStory.id, versionId: saved.id }], admin.id);
  assert.equal(service.getStory(chosenStory.id).approvedVersionId, saved.id);
  assert.throws(() => store.run('UPDATE story_versions SET data=? WHERE id=?', '{}', saved.id));
  layout.body.text = 'A new revision after approval.';
  const draft = service.saveStory(chosenStory.id, saved.id, layout, admin.id);
  assert.equal(service.getStory(chosenStory.id).approvedVersionId, null);
  assert.ok(service.getVersion(saved.id).approvedAt);
  assert.throws(
    () => service.approve([{ storyId: chosenStory.id, versionId: saved.id }], admin.id),
    (e: unknown) => e instanceof AppError && e.status === 409,
  );
  assert.throws(
    () => service.saveStory(chosenStory.id, saved.id, layout, admin.id),
    (e: unknown) => e instanceof AppError && e.status === 409,
  );
  chosenStory = service.getStory(draft.storyId);
});
test('each text layer keeps its own weight, case, spacing, shadow and color', () => {
  const base = chosenStory.version;
  const layout = structuredClone(base.data.layout);
  layout.body = {
    ...layout.body,
    text: 'Small batch roast',
    bold: true,
    uppercase: true,
    lineHeight: 1.6,
    shadow: true,
    color: '#ffffff',
  };
  layout.headline.bold = false;
  const saved = service.saveStory(chosenStory.id, base.id, layout, admin.id);
  assert.equal(saved.data.layout.body.lineHeight, 1.6);
  const legacy = { ...layout, cta: { ...layout.body, text: 'Old call to action' } };
  const cleaned = service.saveStory(chosenStory.id, saved.id, legacy, admin.id);
  assert.equal('cta' in cleaned.data.layout, false, 'old CTA layers are dropped on save');
  assert.doesNotMatch(composition.renderSvg(cleaned.data), /Old call to action/);
  const svg = composition.renderSvg(saved.data);
  const body = svg.match(/<text[^>]*fill="#ffffff"[^>]*>.*?<\/text>/)?.[0] || '';
  assert.match(body, /font-weight="700"/);
  assert.match(body, /filter="url\(#shadow\)"/);
  assert.match(body, /SMALL BATCH ROAST/);
  assert.match(svg, new RegExp(`font-size="${layout.headline.size}" font-weight="400"`));
  assert.throws(
    () =>
      service.saveStory(
        chosenStory.id,
        cleaned.id,
        { ...layout, body: { ...layout.body, lineHeight: 9 } },
        admin.id,
      ),
    /2\.5/,
  );
  chosenStory = service.getStory(chosenStory.id);
});
test('regenerate retains script, new idea changes copy, and both preserve earlier versions', async () => {
  const before = chosenStory.version;
  const image = await service.reviseStory(chosenStory.id, before.id, 'image', admin.id);
  assert.deepEqual(image.data.script, before.data.script);
  assert.notEqual(image.data.backgroundId, before.data.backgroundId);
  assert.notEqual(
    storage.localStorage.read(image.data.backgroundId).bytes.toString(),
    storage.localStorage.read(before.data.backgroundId).bytes.toString(),
  );
  const idea = await service.reviseStory(chosenStory.id, image.id, 'idea', admin.id);
  assert.notEqual(idea.data.script.topic, image.data.script.topic);
  assert.notEqual(idea.data.script.headline, image.data.script.headline);
  assert.equal(service.getVersion(before.id).data.backgroundId, before.data.backgroundId);
  chosenStory = service.getStory(chosenStory.id);
});
test('manual script is exact, editing project affects future drafts, and archive retains history', async () => {
  const script = {
    topic: 'A manual test',
    headline: 'Exact PM supplied headline!',
    body: 'Exact body. No rewriting.',
    visual: 'Exact supplied visual instructions',
    sources: [],
  };
  const story = await service.createManual(
    initialProject.id,
    script,
    admin.id,
    'test-exact-manual-copy',
  );
  assert.deepEqual(story.version.data.script, script);
  const concurrent = await Promise.all([
    service.createManual(initialProject.id, script, admin.id, 'test-concurrent-manual'),
    service.createManual(initialProject.id, script, admin.id, 'test-concurrent-manual'),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  const before = story.version.data.project;
  const updated = service.saveProject(
    {
      ...initialProject,
      facts: 'Our new approved fact appears in future drafts.',
      colors: ['#eeeeee', '#333333', '#dddddd'],
    },
    initialProject.id,
  );
  const next = await service.makeSnapshot(updated, 1, 172);
  assert.equal(next.script.body, 'Our new approved fact appears in future drafts.');
  assert.deepEqual(service.getVersion(story.latestVersionId).data.project.colors, before.colors);
  service.saveProject({ ...updated, status: 'archived' }, updated.id);
  assert.equal(service.getStory(story.id).id, story.id);
  assert.throws(() => service.enqueueRun(updated.id, 'manual'));
  service.saveProject({ ...updated, status: 'active' }, updated.id);
});
test('feedback reports applied changes truthfully; unsupported requests remain saved', async () => {
  const current = service.getStory(chosenStory.id);
  const result = await service.requestChanges(
    current.id,
    current.latestVersionId,
    'layout',
    'Center the text',
    admin.id,
  );
  assert.equal(result.applied, true);
  const next = service.getStory(current.id);
  assert.equal(next.version.data.layout.headline.align, 'center');
  const unsupported = await service.requestChanges(
    next.id,
    next.latestVersionId,
    'text',
    'Write a long poetic story about dolphins',
    admin.id,
  );
  assert.equal(unsupported.applied, false);
  assert.equal(service.getStory(next.id).latestVersionId, next.latestVersionId);
  assert.equal((service.feedbackFor(next.id)[0] as { applied: number }).applied, 0);
  const restored = service.restoreVersion(
    next.id,
    current.latestVersionId,
    next.latestVersionId,
    admin.id,
  );
  assert.equal(restored.revision, next.version.revision + 1);
  assert.deepEqual(restored.data, current.version.data);
});
test('Los Angeles dates and 8AM schedule cover both daylight-saving transitions', () => {
  assert.equal(schedule.eightAM('2026-03-07').toISOString(), '2026-03-07T16:00:00.000Z');
  assert.equal(schedule.eightAM('2026-03-08').toISOString(), '2026-03-08T15:00:00.000Z');
  assert.equal(schedule.eightAM('2026-10-31').toISOString(), '2026-10-31T15:00:00.000Z');
  assert.equal(schedule.eightAM('2026-11-01').toISOString(), '2026-11-01T16:00:00.000Z');
  assert.equal(schedule.businessDate(new Date('2026-09-30T05:00:00Z')), '2026-09-29');
  assert.equal(schedule.nextRun(new Date('2026-11-01T16:01:00Z')), '2026-11-02T16:00:00.000Z');
});
test('scheduler waits until 8AM, prevents duplicates, and skips paused or archived projects', async () => {
  store.setSetting('automationEnabled', 'true');
  const date = '2030-02-15';
  await service.workerTick(new Date(`${date}T15:59:00Z`));
  assert.equal(store.query('SELECT id FROM runs WHERE businessDate=?', date).length, 0);
  await service.workerTick(new Date(`${date}T16:00:00Z`));
  const first = store.query('SELECT id FROM runs WHERE businessDate=?', date).length;
  assert.equal(first, service.listProjects().filter((p) => p.status === 'active').length);
  service.dailyBatch(new Date(`${date}T20:00:00Z`));
  assert.equal(store.query('SELECT id FROM runs WHERE businessDate=?', date).length, first);
  assert.equal(
    store.query(
      "SELECT r.id FROM runs r JOIN projects p ON p.id=r.projectId WHERE r.businessDate=? AND p.status!='active'",
      date,
    ).length,
    0,
  );
});
test('bounded retries, restart recovery, and only failed slots are retried', async () => {
  const runId = service.enqueueRun(initialProject.id, 'manual', new Date(), 'test-retry-slots');
  const job = store.one<import('../lib/types').Job>(
    'SELECT * FROM jobs WHERE runId=? AND slot=1',
    runId,
  )!;
  for (let attempts = 1; attempts <= 3; attempts++) {
    store.run("UPDATE jobs SET attempts=?,status='running' WHERE id=?", attempts, job.id);
    await service.processJob({ ...job, attempts }, new Date(), true);
  }
  assert.equal(
    store.one<{ status: string }>('SELECT status FROM jobs WHERE id=?', job.id)?.status,
    'failed',
  );
  for (let slot = 2; slot <= 4; slot++) {
    const other = store.one<import('../lib/types').Job>(
      'SELECT * FROM jobs WHERE runId=? AND slot=?',
      runId,
      slot,
    )!;
    await service.processJob({ ...other, attempts: 1 });
  }
  const successful = service
    .listStories()
    .filter((s) => s.runId === runId)
    .map((s) => s.id);
  service.retryRun(runId);
  assert.equal(
    store.query("SELECT id FROM jobs WHERE runId=? AND status='queued'", runId).length,
    1,
  );
  await service.processJob({ ...job, attempts: 1 });
  assert.deepEqual(
    service
      .listStories()
      .filter((s) => s.runId === runId && s.slot !== 1)
      .map((s) => s.id)
      .sort(),
    successful.sort(),
  );
  const recoveryId = service.enqueueRun(
    initialProject.id,
    'manual',
    new Date(),
    'test-restart-recovery',
  );
  store.run(
    "UPDATE jobs SET status='running',attempts=1,claimedAt=? WHERE runId=? AND slot=1",
    '2000-01-01T00:00:00Z',
    recoveryId,
  );
  service.recoverJobs();
  assert.equal(
    store.one<{ status: string }>('SELECT status FROM jobs WHERE runId=? AND slot=1', recoveryId)
      ?.status,
    'queued',
  );
});
test('10 active projects create exactly 40 daily slots and enforce the project limit', async () => {
  let n = 0;
  while (service.listProjects().filter((p) => p.status === 'active').length < 10)
    service.saveProject({ ...initialProject, name: `Capacity test ${++n}` });
  const at = new Date('2031-05-10T18:00:00Z');
  const runs = service.dailyBatch(at);
  assert.equal(runs.length, 10);
  assert.equal(
    store.query(
      'SELECT j.id FROM jobs j JOIN runs r ON r.id=j.runId WHERE r.businessDate=?',
      '2031-05-10',
    ).length,
    40,
  );
  assert.throws(() => service.saveProject({ ...initialProject, name: 'One project too many' }));
  for (let i = 0; i < 100; i++) {
    const job = service.claimJob(at);
    if (!job) break;
    await service.processJob(job, at);
  }
  assert.equal(service.listStories().filter((s) => s.businessDate === '2031-05-10').length, 40);
  for (const runId of runs)
    assert.equal(
      new Set(
        service
          .listStories()
          .filter((s) => s.runId === runId)
          .map((s) => s.version.data.script.topic),
      ).size,
      4,
    );
  service.dailyBatch(at);
  assert.equal(
    store.query(
      'SELECT j.id FROM jobs j JOIN runs r ON r.id=j.runId WHERE r.businessDate=?',
      '2031-05-10',
    ).length,
    40,
  );
});
test('PNG dimensions, artwork/text/logo composition, frozen font references, overflow validation', async () => {
  const story = service.getStory(chosenStory.id);
  const png = composition.renderPng(story.version.data);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.ok(story.version.data.fontAssets?.Inter);
  const stripped = structuredClone(story.version.data);
  stripped.layout.logo.visible = false;
  for (const key of ['headline', 'body'] as const) stripped.layout[key].visible = false;
  assert.notDeepEqual(png, composition.renderPng(stripped));
  stripped.layout.headline.visible = true;
  stripped.layout.headline.text = 'A long story that cannot fit safely at the bottom';
  stripped.layout.headline.y = 1800;
  assert.ok(composition.validateComposition(stripped).length);
  assert.throws(() => composition.renderPng(stripped));
  service.approve([{ storyId: story.id, versionId: story.latestVersionId }], admin.id);
});
test('actual route authorization, administrator controls, approved exports, and ZIP contents', async () => {
  const { GET: download } = await import('../app/api/export/[version]/route');
  const { POST: zipExport } = await import('../app/api/export/route');
  const { GET: assetRoute } = await import('../app/api/assets/[id]/route');
  const { POST: commandRoute } = await import('../app/api/command/route');
  const story = service.getStory(chosenStory.id);
  const anonymous = new Request('http://localhost:3000/api/export/' + story.latestVersionId);
  assert.equal(
    (await download(anonymous, { params: Promise.resolve({ version: story.latestVersionId }) }))
      .status,
    401,
  );
  assert.equal(
    (
      await assetRoute(new Request('http://localhost:3000/api/assets/test'), {
        params: Promise.resolve({ id: 'test' }),
      })
    ).status,
    401,
  );
  const adminSession = auth.localAuth.signIn('admin', '9741faso');
  const headers = { 'Content-Type': 'application/json', cookie: `storyloom=${adminSession.token}` };
  const get = () =>
    download(new Request(anonymous, { headers }), {
      params: Promise.resolve({ version: story.latestVersionId }),
    });
  // Downloads default to high-quality JPEG; PNG stays available as a setting.
  const jpeg = await get();
  assert.equal(jpeg.status, 200);
  assert.equal(jpeg.headers.get('Content-Type'), 'image/jpeg');
  assert.match(jpeg.headers.get('Content-Disposition')!, /_v\d+\.jpg/);
  const jpegMeta = await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata();
  assert.deepEqual([jpegMeta.format, jpegMeta.width, jpegMeta.height], ['jpeg', 1080, 1920]);
  store.setSetting('exportFormat', 'png');
  const png = await get();
  assert.equal(png.headers.get('Content-Type'), 'image/png');
  assert.match(png.headers.get('Content-Disposition')!, /_v\d+\.png/);
  store.setSetting('exportFormat', 'jpeg');
  const zipped = await zipExport(
    new Request('http://localhost:3000/api/export', {
      method: 'POST',
      headers,
      body: JSON.stringify({ versionIds: [story.latestVersionId] }),
    }),
  );
  assert.equal(zipped.status, 200);
  const zip = await JSZip.loadAsync(await zipped.arrayBuffer());
  const files = Object.keys(zip.files);
  assert.equal(files.length, 1);
  assert.match(files[0], /story-.*_v\d+\.jpg/);
  const denied = await commandRoute(
    new Request('http://localhost:3000/api/command', {
      method: 'POST',
      headers: { ...headers, cookie: 'storyloom=old-manager-session' },
      body: JSON.stringify({ action: 'dailyBatch' }),
    }),
  );
  assert.equal(denied.status, 401);
  for (const action of ['invite', 'teamStatus', 'resetPassword']) {
    const removed = await commandRoute(
      new Request('http://localhost:3000/api/command', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action }),
      }),
    );
    assert.equal(removed.status, 400);
  }
  const { POST: signIn } = await import('../app/api/auth/route');
  const login = await signIn(
    new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '9741faso' }),
    }),
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(login.headers.get('set-cookie')!, /SameSite=lax/i);
  assert.equal((await login.json()).user.username, 'admin');
  const oldLogin = await signIn(
    new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pm@storyloom.local', password: 'StoryloomDev!2026' }),
    }),
  );
  assert.equal(oldLogin.status, 401);
  const deniedOrigin = await commandRoute(
    new Request('http://localhost:3000/api/command', {
      method: 'POST',
      headers: { ...headers, origin: 'https://other.example' },
      body: JSON.stringify({ action: 'dailyBatch' }),
    }),
  );
  assert.equal(deniedOrigin.status, 403);
  const draft = service.listStories().find((s) => !s.approvedVersionId)!;
  assert.equal(
    (
      await download(new Request(anonymous, { headers }), {
        params: Promise.resolve({ version: draft.latestVersionId }),
      })
    ).status,
    403,
  );
  assert.ok(service.getStory(story.id).exportCount >= 2);
});
test('unconfigured providers never impersonate connected services', async () => {
  store.setSetting('providerMode', 'unconfigured');
  await assert.rejects(service.makeSnapshot(initialProject, 1, 55), /not configured/);
  store.setSetting('providerMode', 'demo');
  const providers = await import('../lib/providers');
  await assert.rejects(
    providers.openAIScript.generate(initialProject, 1, 12, []),
    /not configured/,
  );
  assert.throws(() => providers.supabaseRepository.listProjects(), /not configured/);
});
