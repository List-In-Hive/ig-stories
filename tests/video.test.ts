import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-video-'));
Object.assign(process.env, { NODE_ENV: 'test', RUNWAYML_API_SECRET: 'test-key' });
const db = await import('../lib/db');
const service = await import('../lib/services');
const video = await import('../lib/video');
const animate = await import('../lib/animate');
const lifecycle = await import('../lib/lifecycle');
const auth = await import('../lib/auth');
const admin = auth.localAuth.signIn('admin', '9741faso').user;

const project = service.saveProject({
  name: 'Video Cafe',
  industry: 'Coffee',
  description: 'A neighborhood cafe with slow coffee.',
  colors: ['#f3eee8', '#172420', '#2525e0', '#e8e6f7'],
  status: 'paused',
});
service.enqueueRun(project.id, 'manual', new Date(), db.id());
for (let i = 0; i < 4; i++) await service.processJob(service.claimJob()!);
const story = service.listStories().find((s) => s.projectId === project.id)!;
service.approve([{ storyId: story.id, versionId: story.latestVersionId }], admin.id);
const version = service.exportVersion(story.latestVersionId);

const info = (bytes: Buffer) => {
  const file = path.join(process.env.DATA_DIR!, `info-${Math.random()}.mp4`);
  fs.writeFileSync(file, bytes);
  try {
    execFileSync(video.ffmpegPath(), ['-hide_banner', '-i', file], { stdio: 'pipe' });
  } catch (error) {
    return String((error as { stderr: Buffer }).stderr);
  }
  return '';
};

test('an approved story becomes an 8-second 1080x1920 H.264 video', async () => {
  const bytes = await video.renderVideo(version.data, { motion: 'pan' });
  const details = info(bytes);
  assert.match(details, /h264/);
  assert.match(details, /yuv420p/);
  assert.match(details, /1080x1920/);
  assert.match(details, /Duration: 00:00:08/);
});

test('Animate with AI sends the clean background to Runway and adds the story text', async () => {
  const clip = await video.renderVideo(version.data, { motion: 'zoom-out', seconds: 2 });
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let status = 'RUNNING';
  animate.setRunwayFetch((async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/image_to_video')) return Response.json({ id: 'task-1' });
    if (url.endsWith('/tasks/task-1'))
      return Response.json({
        status,
        output: status === 'SUCCEEDED' ? ['https://cdn.example/clip.mp4'] : undefined,
      });
    if (url === 'https://cdn.example/clip.mp4') return new Response(new Uint8Array(clip));
    return new Response('missing', { status: 404 });
  }) as typeof fetch);

  const started = await animate.startAnimation(version.id, version.data, 'steam rising');
  assert.equal(started.status, 'running');
  const request = calls[0].body!;
  assert.equal(request.ratio, '720:1280');
  assert.match(String(request.promptImage), /^data:image\/jpeg;base64,/);
  assert.match(String(request.promptText), /steam rising/);
  assert.match(String(request.promptText), /No text/);

  assert.equal((await animate.checkAnimation(version.id, version.data))?.status, 'running');
  status = 'SUCCEEDED';
  const done = await animate.checkAnimation(version.id, version.data);
  assert.equal(done?.status, 'ready');
  const details = info(
    fs.readFileSync(path.join(process.env.DATA_DIR!, 'assets', `${done!.assetId}.mp4`)),
  );
  assert.match(details, /1080x1920/);
  assert.match(details, /Duration: 00:00:05/);

  // The finished video survives the unused-asset sweep while its version exists.
  lifecycle.sweepUnusedAssets(new Date(Date.now() + 86_400_000));
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, 'assets', `${done!.assetId}.mp4`)));
});

test('a failed Runway task is reported, and drafts cannot be animated', async () => {
  animate.setRunwayFetch((async (input: string | URL) =>
    String(input).endsWith('/image_to_video')
      ? Response.json({ id: 'task-2' })
      : Response.json({ status: 'FAILED', failure: 'Content moderation' })) as typeof fetch);
  const other = service.listStories().find((s) => s.projectId === project.id && s.id !== story.id)!;
  service.approve([{ storyId: other.id, versionId: other.latestVersionId }], admin.id);
  const approved = service.exportVersion(other.latestVersionId);
  await animate.startAnimation(approved.id, approved.data);
  const failed = await animate.checkAnimation(approved.id, approved.data);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.error, 'Content moderation');
  const draft = service
    .listStories()
    .find((s) => s.projectId === project.id && !s.approvedVersionId)!;
  assert.throws(() => service.exportVersion(draft.latestVersionId), /approved/);
});
