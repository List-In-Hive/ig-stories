import sharp from 'sharp';
import { setting, setSetting } from './db';
import { AppError } from './errors';
import { renderPng } from './composition';
import { localStorage } from './storage';
import { renderVideo } from './video';
import type { Snapshot } from './types';

// "Animate with AI": Runway turns the story background into a short moving clip, then the
// story's own text and logo are laid over it, so the words stay exact and sharp.
// Needs RUNWAYML_API_SECRET; each 5-second clip costs about $0.25 with gen4_turbo.
const API = 'https://api.dev.runwayml.com/v1';
const MODEL = process.env.RUNWAY_MODEL || 'gen4_turbo';
export const AI_VIDEO_SECONDS = 5;
export const aiVideoConfigured = () => !!process.env.RUNWAYML_API_SECRET;

let fetcher: typeof fetch = (input, init) => fetch(input, init);
export function setRunwayFetch(next: typeof fetch) {
  fetcher = next;
}

export type Animation = {
  status: 'running' | 'ready' | 'failed';
  taskId?: string;
  assetId?: string;
  error?: string;
  startedAt: string;
};
const key = (versionId: string) => `animation:${versionId}`;
export function animation(versionId: string): Animation | null {
  const value = setting(key(versionId), '');
  return value ? (JSON.parse(value) as Animation) : null;
}
const save = (versionId: string, value: Animation) => {
  setSetting(key(versionId), JSON.stringify(value));
  return value;
};

async function runway<T>(path: string, init: RequestInit = {}) {
  const response = await fetcher(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
      'X-Runway-Version': '2024-11-06',
      'Content-Type': 'application/json',
    },
  });
  if (response.status === 401)
    throw new AppError('Runway did not accept RUNWAYML_API_SECRET. Check the key.');
  if (response.status === 429)
    throw new AppError('Runway is busy or out of credits. Try again in a minute.');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Runway error', response.status, detail.slice(0, 500));
    throw new AppError(
      /credit/i.test(detail)
        ? 'Runway has no credits left. Add credits in the Runway developer portal.'
        : `Runway could not start the video (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

// The clip should only move: no new text, and the empty area stays empty for our words.
function motionPrompt(snapshot: Snapshot, prompt: string) {
  const area = snapshot.script.placement === 'bottom' ? 'lower half' : 'upper half';
  return [
    prompt.trim() ||
      'Slow, subtle cinematic motion: gentle camera push-in, soft natural movement in the scene, calm and premium.',
    `Keep the framing and the ${area} calm and uncluttered.`,
    'No text, letters, logos or new people. No cuts.',
  ]
    .join(' ')
    .slice(0, 1000);
}

export async function startAnimation(versionId: string, snapshot: Snapshot, prompt = '') {
  if (!aiVideoConfigured())
    throw new AppError('Add RUNWAYML_API_SECRET to the environment to animate with AI.');
  const current = animation(versionId);
  if (current?.status === 'running') return current;
  // Runway gets the clean background (no text) as the first frame.
  const image = await sharp(renderPng(snapshot, ['background']))
    .resize(720, 1280)
    .jpeg({ quality: 90 })
    .toBuffer();
  const task = await runway<{ id: string }>('/image_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL,
      promptImage: `data:image/jpeg;base64,${image.toString('base64')}`,
      promptText: motionPrompt(snapshot, prompt),
      ratio: '720:1280',
      duration: AI_VIDEO_SECONDS,
    }),
  });
  return save(versionId, {
    status: 'running',
    taskId: task.id,
    startedAt: new Date().toISOString(),
  });
}

type Task = { status: string; output?: string[]; failure?: string };
const finishing = new Map<string, Promise<Animation>>();
// The editor polls this while Runway works; the finished clip gets the story text on top.
export async function checkAnimation(versionId: string, snapshot: Snapshot) {
  const current = animation(versionId);
  if (!current || current.status !== 'running' || !current.taskId) return current;
  if (finishing.has(versionId)) return finishing.get(versionId)!;
  const task = await runway<Task>(`/tasks/${encodeURIComponent(current.taskId)}`);
  if (['FAILED', 'CANCELLED'].includes(task.status))
    return save(versionId, {
      ...current,
      status: 'failed',
      error: task.failure || 'Runway could not animate this story. Try again or change the prompt.',
    });
  if (task.status !== 'SUCCEEDED' || !task.output?.[0]) return current;
  const done = (async () => {
    try {
      const response = await fetcher(task.output![0]);
      if (!response.ok) throw new AppError('The AI video could not be downloaded. Try again.');
      const clip = Buffer.from(await response.arrayBuffer());
      const video = await renderVideo(snapshot, { clip, seconds: AI_VIDEO_SECONDS });
      const assetId = localStorage.put(video, 'video/mp4', 'story-video', 1080, 1920);
      return save(versionId, { ...current, status: 'ready', assetId });
    } catch (error) {
      return save(versionId, { ...current, status: 'failed', error: (error as Error).message });
    } finally {
      finishing.delete(versionId);
    }
  })();
  finishing.set(versionId, done);
  return done;
}
