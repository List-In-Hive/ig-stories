import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type { Job, Script } from '../lib/types';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-lifecycle-'));
Object.assign(process.env, { NODE_ENV: 'test', WORKER_MAX_ATTEMPTS: '3' });
const db = await import('../lib/db');
const service = await import('../lib/services');
const lifecycle = await import('../lib/lifecycle');
const storage = await import('../lib/storage');
const schedule = await import('../lib/schedule');
const providers = await import('../lib/providers');
const auth = await import('../lib/auth');
const composition = await import('../lib/composition');
const { hasEngagement } = await import('../lib/engagement');
const admin = auth.localAuth.signIn('admin', '9741faso').user;
const base = {
  industry: 'Creative studio',
  description: 'A studio creating thoughtful designs for everyday spaces.',
  services: 'Design concepts, Brand styling',
  colors: ['#eeeeff', '#2525e0', '#dcf46b'],
  facts: 'We create thoughtful everyday designs.',
  status: 'paused',
};
const fixture = (name: string, extra: Record<string, unknown> = {}) =>
  service.saveProject({ ...base, name, ...extra });
const plain: Script = {
  topic: 'A thoughtful detail',
  headline: 'A thoughtful detail.',
  body: 'Considered design for everyday spaces.',
  visual: 'Abstract shapes',
  sources: [],
};
async function logo() {
  return storage.uploadLogo(
    await sharp({ create: { width: 80, height: 80, channels: 4, background: '#2525e0' } })
      .png()
      .toBuffer(),
    'image/png',
  );
}
function dateStory(storyId: string, date: string) {
  const s = service.getStory(storyId);
  db.run('UPDATE stories SET businessDate=? WHERE id=?', date, storyId);
  db.run('UPDATE runs SET businessDate=? WHERE id=?', date, s.runId);
}

test('engagement switch controls generated polls, questions, DM prompts, edits, and manual creation', async () => {
  let project = fixture('Engagement settings');
  assert.equal(project.allowEngagement, false);
  for (let slot = 1; slot <= 4; slot++)
    assert.equal(
      hasEngagement((await service.makeSnapshot(project, slot, 100 + slot)).script),
      false,
    );
  for (const script of [
    { ...plain, headline: 'Do you like this idea?' },
    { ...plain, body: 'DM us for details' },
    { ...plain, body: 'Reply with your favorite' },
    { ...plain, kind: 'poll' as const },
  ])
    await assert.rejects(service.createManual(project.id, script, admin.id, db.id()), /disabled/);
  const info = await service.createManual(project.id, plain, admin.id, db.id());
  const invalidLayout = structuredClone(info.version.data.layout);
  invalidLayout.headline.text = 'Do you like this?';
  assert.throws(
    () => service.saveStory(info.id, info.latestVersionId, invalidLayout, admin.id),
    /disabled/,
  );
  project = service.saveProject({ ...project, allowEngagement: true }, project.id);
  const scripts: Script[] = [];
  for (let slot = 1; slot <= 4; slot++) {
    const snapshot = await service.makeSnapshot(project, slot, 200 + slot);
    scripts.push(snapshot.script);
    assert.deepEqual(composition.validateComposition(snapshot), []);
  }
  assert.equal(scripts[1].kind, 'poll');
  assert.match(scripts[1].body, /A\. .*\nB\./);
  assert.equal(scripts[2].kind, 'question');
  assert.match(scripts[2].headline, /Do you like/);
  assert.equal(scripts[3].kind, 'dm');
  assert.match(scripts[3].body, /DM us to find out more/);
  await assert.rejects(
    service.createManual(project.id, { ...plain, kind: 'poll' }, admin.id, db.id()),
    /two to four/,
  );
  for (const body of ['A. One\nB. Two\nC. Three\nD. Four\nE. Five', 'A. One\nA. Two'])
    await assert.rejects(
      service.createManual(project.id, { ...plain, kind: 'poll', body }, admin.id, db.id()),
      /two to four/,
    );
  const poll = await service.createManual(
    project.id,
    {
      ...plain,
      kind: 'poll',
      headline: 'Which do you like?',
      body: 'A. Calm colors\nB. Bold colors',
    },
    admin.id,
    db.id(),
  );
  service.approve([{ storyId: poll.id, versionId: poll.latestVersionId }], admin.id);
  const meta = await sharp(composition.renderPng(poll.version.data)).metadata();
  assert.equal(meta.height, 1920);
  project = service.saveProject({ ...project, allowEngagement: false }, project.id);
  await assert.rejects(
    service.createManual(project.id, { ...plain, body: 'Message us' }, admin.id, db.id()),
    /disabled/,
  );
  const informational = structuredClone(poll.version.data.layout);
  informational.headline.text = 'A thoughtful detail.';
  informational.body.text = 'Considered design for everyday spaces.';
  const converted = service.saveStory(poll.id, poll.latestVersionId, informational, admin.id);
  assert.equal(converted.data.script.kind, undefined);
  const newIdea = await service.reviseStory(poll.id, converted.id, 'idea', admin.id);
  assert.equal(hasEngagement(newIdea.data.script), false);
  assert.throws(
    () => service.restoreVersion(poll.id, poll.latestVersionId, newIdea.id, admin.id),
    /disabled/,
  );
});

test('changing the engagement setting refreshes queued scripts and preserves distinct topics', async () => {
  const project = fixture('Queued content switch', { allowEngagement: true });
  const runId = service.enqueueRun(project.id, 'manual', new Date(), db.id());
  const first = service.claimJob()!;
  await service.processJob(first);
  assert.ok(
    db
      .query<{ data: string }>('SELECT data FROM run_scripts WHERE runId=?', runId)
      .some((r) => hasEngagement(JSON.parse(r.data))),
  );
  service.saveProject({ ...project, allowEngagement: false }, project.id);
  assert.equal(db.query('SELECT * FROM run_scripts WHERE runId=?', runId).length, 0);
  for (let slot = 2; slot <= 4; slot++) {
    const job = service.claimJob()!;
    await service.processJob(job);
  }
  const stories = service.listStories().filter((s) => s.runId === runId);
  assert.equal(stories.length, 4);
  assert.ok(stories.every((s) => !hasEngagement(s.version.data.script)));
  assert.equal(new Set(stories.map((s) => s.version.data.script.topic)).size, 4);
});

test('confirmed project deletion removes every relation and unique file, preserving shared assets', async () => {
  const shared = await logo();
  let project = fixture('Delete this fixture', { logoId: shared });
  const keeper = fixture('Shared logo keeper', { logoId: shared });
  const old = await service.createManual(project.id, plain, admin.id, db.id());
  const replacement = await logo();
  project = service.saveProject({ ...project, logoId: replacement }, project.id);
  const story = await service.createManual(project.id, plain, admin.id, db.id());
  const layout = structuredClone(story.version.data.layout);
  layout.body.text = 'Updated considered design.';
  const edited = service.saveStory(story.id, story.latestVersionId, layout, admin.id);
  await service.requestChanges(story.id, edited.id, 'layout', 'Center the text', admin.id);
  const current = service.getStory(story.id);
  service.approve([{ storyId: current.id, versionId: current.latestVersionId }], admin.id);
  service.recordExport(current.version, admin.id, 'png');
  await service.reviseStory(story.id, current.latestVersionId, 'image', admin.id);
  const runId = service.enqueueRun(project.id, 'manual', new Date(), db.id());
  const job = service.claimJob()!;
  await service.processJob(job);
  const staleJob = service.claimJob()!;
  const owned = db.query<{ assetId: string; filename: string }>(
    'SELECT pa.assetId,a.filename FROM project_assets pa JOIN assets a ON a.id=pa.assetId WHERE projectId=?',
    project.id,
  );
  const ids = service
    .listStories()
    .filter((s) => s.projectId === project.id)
    .map((s) => s.id);
  const runs = db
    .query<{ id: string }>('SELECT id FROM runs WHERE projectId=?', project.id)
    .map((r) => r.id);
  assert.throws(() => lifecycle.deleteProject(project.id, 'wrong name'), /Type the project name/);
  assert.equal(service.getProject(project.id).id, project.id);
  assert.throws(() => db.run('DELETE FROM story_versions WHERE storyId=?', old.id), /immutable/);
  const result = lifecycle.deleteProject(project.id, project.name);
  assert.equal(result.pendingFileDeletes, 0);
  assert.equal(result.storiesDeleted, ids.length);
  await service.processJob(staleJob);
  assert.throws(() => service.getProject(project.id), /not found/);
  for (const table of ['stories', 'runs', 'research', 'project_assets'])
    assert.equal(db.query(`SELECT * FROM ${table} WHERE projectId=?`, project.id).length, 0);
  for (const storyId of ids)
    for (const table of ['story_versions', 'feedback', 'approvals', 'exports', 'operations'])
      assert.equal(db.query(`SELECT * FROM ${table} WHERE storyId=?`, storyId).length, 0);
  for (const id of runs)
    for (const table of ['jobs', 'run_scripts'])
      assert.equal(db.query(`SELECT * FROM ${table} WHERE runId=?`, id).length, 0);
  for (const asset of owned) {
    if (asset.assetId === shared || db.one('SELECT id FROM assets WHERE id=?', asset.assetId))
      continue;
    assert.equal(fs.existsSync(path.join(db.dataDir, 'assets', asset.filename)), false);
  }
  assert.equal(db.one('SELECT id FROM assets WHERE id=?', replacement), undefined);
  assert.ok(storage.localStorage.read(shared).bytes.length);
  assert.equal(service.getProject(keeper.id).logoId, shared);
  assert.equal(db.query('SELECT * FROM story_purges').length, 0);
  assert.deepEqual(db.query('PRAGMA foreign_key_check'), []);
  assert.equal(db.one('SELECT id FROM runs WHERE id=?', runId), undefined);
});

test('file deletion errors survive database deletion and retry successfully', async (t) => {
  const logoId = await logo();
  const project = fixture('Disk cleanup retry', { logoId });
  const filename = path.basename(storage.assetPath(logoId));
  const original = fs.unlinkSync;
  const mock = t.mock.method(fs, 'unlinkSync', (file: fs.PathLike) => {
    if (String(file).endsWith(filename))
      throw Object.assign(new Error('Busy file'), { code: 'EBUSY' });
    original(file);
  });
  const result = lifecycle.deleteProject(project.id, project.name);
  assert.equal(result.pendingFileDeletes, 1);
  assert.equal(db.one('SELECT id FROM assets WHERE id=?', logoId), undefined);
  assert.ok(fs.existsSync(path.join(db.dataDir, 'assets', filename)));
  mock.mock.restore();
  assert.equal(lifecycle.drainAssetDeletions(), 0);
  assert.equal(fs.existsSync(path.join(db.dataDir, 'assets', filename)), false);
});

test('deletion during an in-flight provider call cannot resurrect data or images', async (t) => {
  const project = fixture('In-flight deletion');
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const original = providers.demoImage.generate;
  t.mock.method(providers.demoImage, 'generate', async (...args: Parameters<typeof original>) => {
    started();
    await waiting;
    return original(...args);
  });
  const creating = service.createManual(project.id, plain, admin.id, db.id());
  await ready;
  lifecycle.deleteProject(project.id, project.name);
  release();
  await assert.rejects(creating, /not found/);
  assert.equal(db.query('SELECT * FROM stories WHERE projectId=?', project.id).length, 0);
  assert.equal(db.query('SELECT * FROM project_assets WHERE projectId=?', project.id).length, 0);
  assert.deepEqual(db.query('PRAGMA foreign_key_check'), []);
});

test('history exposes exactly today and the previous two Los Angeles dates', async () => {
  const project = fixture('History window');
  const today = schedule.businessDate(new Date());
  const ids: string[] = [];
  for (let days = 0; days <= 3; days++) {
    const s = await service.createManual(project.id, plain, admin.id, db.id());
    dateStory(s.id, schedule.daysBefore(today, days));
    ids.push(s.id);
  }
  const state = service.state(admin);
  assert.equal(state.historyStart, schedule.daysBefore(today, 2));
  assert.ok(ids.slice(0, 3).every((id) => state.stories.some((s) => s.id === id)));
  assert.ok(!state.stories.some((s) => s.id === ids[3]));
  assert.equal(service.getStory(ids[3]).id, ids[3]);
  assert.equal(schedule.daysBefore('2026-03-09', 2), '2026-03-07');
  assert.equal(schedule.daysBefore('2026-11-02', 2), '2026-10-31');
});

test('retention waits for all daily drafts, then deletes expired relations and files including archived history', async () => {
  const at = new Date('2032-01-05T16:30:00Z');
  const project = fixture('Retention daily set', { status: 'active' });
  const blocker = fixture('Retention blocker', { status: 'active' });
  const archived = fixture('Archived retention', { status: 'archived' });
  const expired: string[] = [];
  let expiredBackground = '';
  let expiredPath = '';
  for (const [p, date] of [
    [project, '2032-01-05'],
    [project, '2032-01-04'],
    [project, '2032-01-03'],
    [project, '2032-01-02'],
  ] as const) {
    const story = await service.createManual(p.id, plain, admin.id, db.id());
    dateStory(story.id, date);
    if (date.endsWith('02')) {
      expired.push(story.id);
      expiredBackground = story.version.data.backgroundId;
      expiredPath = storage.assetPath(expiredBackground);
      service.approve([{ storyId: story.id, versionId: story.latestVersionId }], admin.id);
      service.recordExport(story.version, admin.id, 'png');
    }
  }
  let paused = fixture('Archive after creating');
  const archivedStory = await service.createManual(paused.id, plain, admin.id, db.id());
  dateStory(archivedStory.id, '2032-01-02');
  expired.push(archivedStory.id);
  paused = service.saveProject({ ...paused, status: 'archived' }, paused.id);
  const runId = service.enqueueRun(project.id, 'scheduled', at);
  const blockerRun = service.enqueueRun(blocker.id, 'scheduled', at);
  for (const job of db.query<Job>('SELECT * FROM jobs WHERE runId=?', runId))
    await service.processJob({ ...job, attempts: 1 }, at);
  assert.equal(lifecycle.pruneStoryHistory(at).ready, false);
  for (const id of expired) assert.equal(service.getStory(id).id, id);
  const blockedJobs = db.query<Job>('SELECT * FROM jobs WHERE runId=? ORDER BY slot', blockerRun);
  await service.processJob({ ...blockedJobs[0], attempts: 3 }, at, true);
  for (const job of blockedJobs.slice(1)) await service.processJob({ ...job, attempts: 1 }, at);
  assert.equal(lifecycle.pruneStoryHistory(at).ready, false);
  service.retryRun(blockerRun);
  await service.workerTick(at);
  assert.equal(lifecycle.dailyStoriesReady(at), true);
  for (const id of expired) {
    assert.throws(() => service.getStory(id), /not found/);
    for (const table of ['story_versions', 'approvals', 'exports', 'feedback', 'operations'])
      assert.equal(db.query(`SELECT * FROM ${table} WHERE storyId=?`, id).length, 0);
  }
  assert.equal(db.one('SELECT id FROM assets WHERE id=?', expiredBackground), undefined);
  assert.equal(fs.existsSync(expiredPath), false);
  assert.ok(service.listStories().some((s) => s.businessDate === '2032-01-03'));
  assert.ok(service.listStories().some((s) => s.businessDate === '2032-01-04'));
  assert.ok(service.listStories().some((s) => s.businessDate === '2032-01-05'));
  assert.ok(service.listStories().every((s) => s.businessDate >= '2032-01-03'));
  assert.equal(service.getProject(archived.id).status, 'archived');
  assert.equal(service.getProject(paused.id).status, 'archived');
  assert.equal(db.setting('lastHistoryCleanup', ''), '2032-01-05');
  assert.deepEqual(db.query('PRAGMA foreign_key_check'), []);
  assert.equal(lifecycle.pruneStoryHistory(at).storiesDeleted, 0);
});

test('delete route requires authentication and exact confirmation and removes the project', async () => {
  const { POST } = await import('../app/api/command/route');
  const project = fixture('Route deletion');
  const session = auth.localAuth.signIn('admin', '9741faso');
  const invoke = (headers: Record<string, string>, confirmation: string) =>
    POST(
      new Request('http://localhost:3000/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ action: 'deleteProject', projectId: project.id, confirmation }),
      }),
    );
  assert.equal((await invoke({}, project.name)).status, 401);
  const headers = { cookie: `storyloom=${session.token}` };
  assert.equal((await invoke(headers, 'wrong')).status, 400);
  assert.equal(service.getProject(project.id).id, project.id);
  assert.equal(
    (await invoke({ ...headers, origin: 'https://other.example' }, project.name)).status,
    403,
  );
  assert.equal((await invoke(headers, project.name)).status, 200);
  assert.throws(() => service.getProject(project.id), /not found/);
});
