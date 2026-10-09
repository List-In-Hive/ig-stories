import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-video-'));
Object.assign(process.env, { NODE_ENV: 'test' });
const db = await import('../lib/db');
const service = await import('../lib/services');
const video = await import('../lib/video');
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

test('drafts cannot be exported as video', () => {
  const draft = service
    .listStories()
    .find((s) => s.projectId === project.id && !s.approvedVersionId)!;
  assert.throws(() => service.exportVersion(draft.latestVersionId), /approved/);
});
