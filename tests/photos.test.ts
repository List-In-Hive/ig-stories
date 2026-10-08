import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-photos-'));
Object.assign(process.env, { NODE_ENV: 'test', PIXABAY_API_KEY: 'test-key' });
const db = await import('../lib/db');
const service = await import('../lib/services');
const storage = await import('../lib/storage');
const stock = await import('../lib/stock');
const auth = await import('../lib/auth');
const admin = auth.localAuth.signIn('admin', '9741faso').user;

const jpeg = (background: string) =>
  sharp({ create: { width: 900, height: 1600, channels: 3, background } })
    .jpeg()
    .toBuffer();
const stockBytes = await jpeg('#3a7d44');
const searches: string[] = [];
let stockDown = false;
stock.setStockFetch((async (input: string | URL) => {
  const url = String(input);
  if (stockDown) return new Response('down', { status: 503 });
  if (url.startsWith('https://pixabay.com/api/')) {
    const params = new URL(url).searchParams;
    searches.push(params.get('q') || `id:${params.get('id')}`);
    const ids = params.get('id') ? [Number(params.get('id'))] : [101, 102, 103];
    return Response.json({
      hits: ids.map((id) => ({
        id,
        pageURL: `https://pixabay.com/photos/${id}/`,
        tags: 'coffee, cup',
        webformatURL: `https://cdn.example/${id}_640.jpg`,
        largeImageURL: `https://cdn.example/${id}_1280.jpg`,
        user: 'Ana',
        user_id: 7,
      })),
    });
  }
  return new Response(new Uint8Array(stockBytes));
}) as typeof fetch);

const library = [
  await storage.uploadBrandPhoto(await jpeg('#aa3300')),
  await storage.uploadBrandPhoto(await jpeg('#0033aa')),
];
const project = service.saveProject({
  name: 'Photo Cafe',
  industry: 'Coffee',
  description: 'A neighborhood cafe with slow coffee.',
  colors: ['#f3eee8', '#172420', '#2525e0', '#e8e6f7'],
  status: 'paused',
  photoIds: library,
});

test('a daily run mixes brand photos, stock photos and AI artwork', async () => {
  service.enqueueRun(project.id, 'manual', new Date(), db.id());
  for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
  const stories = service.listStories().filter((s) => s.projectId === project.id);
  const sources = stories.map((s) => s.version.data.script.source).sort();
  assert.deepEqual(sources, ['ai', 'ai', 'library', 'stock']);
  const stocked = stories.find((s) => s.version.data.script.source === 'stock')!;
  assert.equal(stocked.version.data.script.credit?.name, 'Ana');
  assert.ok(searches.length >= 1, 'stock search uses the story photo search');
  const bg = storage.localStorage.read(stocked.version.data.backgroundId);
  assert.deepEqual([bg.width, bg.height], [1080, 1920]);
});

test('the editor can search stock and swap in a stock or brand photo', async () => {
  const story = service.listStories().find((s) => s.projectId === project.id)!;
  const results = await service.findStock('latte art');
  assert.equal(results[0].id, 'pixabay:101');
  const swapped = await service.swapPhoto(
    story.id,
    story.latestVersionId,
    { stock: 'pixabay:102' },
    admin.id,
  );
  assert.equal(swapped.data.script.source, 'stock');
  assert.equal(swapped.data.layout.headline.text, story.version.data.layout.headline.text);
  const own = await service.swapPhoto(story.id, swapped.id, { library: library[1] }, admin.id);
  assert.equal(own.data.script.source, 'library');
  assert.equal(own.data.script.credit, undefined);
  await assert.rejects(
    service.swapPhoto(story.id, own.id, { library: 'not-a-brand-photo' }, admin.id),
    /brand photos/,
  );
});

test('a stock outage falls back to AI artwork instead of failing the run', async () => {
  stockDown = true;
  const next = service.saveProject({ ...project, photoIds: [] }, project.id);
  const runId = service.enqueueRun(next.id, 'manual', new Date(), db.id());
  for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
  const stories = service.listStories().filter((s) => s.runId === runId);
  assert.equal(stories.length, 4);
  assert.ok(stories.every((s) => s.version.data.script.source !== 'stock'));
  stockDown = false;
});

test('brand photos must be uploaded photos', () => {
  assert.throws(
    () => service.saveProject({ ...project, photoIds: [project.id] }, project.id),
    /brand photos/,
  );
});
