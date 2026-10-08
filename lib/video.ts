import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { renderPng, type Part } from './composition';
import { AppError } from './errors';
import type { Snapshot } from './types';

// Animated stories: the approved story becomes an MP4 with a slow camera move on the background
// and the text easing in on top. Text and logo stay the crisp vector renders from the image export.
export const MOTIONS = ['zoom-in', 'zoom-out', 'pan'] as const;
export type Motion = (typeof MOTIONS)[number];
export const VIDEO_SECONDS = 8;
const FPS = 30;

// FFMPEG_PATH wins, then the bundled ffmpeg-static binary, then whatever is on PATH.
export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Not installed; fall back to ffmpeg on PATH.
  }
  return 'ffmpeg';
}
const exec = promisify(execFile);
async function ffmpeg(args: string[]) {
  try {
    await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch (error) {
    const detail = String((error as { stderr?: string }).stderr || (error as Error).message);
    console.error('ffmpeg failed:', detail.slice(-2000));
    throw new AppError('The video could not be made. Try again or download the image.');
  }
}

// Each part fades in and eases up into place, one after another.
const entrances: { part: Exclude<Part, 'background'>; start: number; rise: number }[] = [
  { part: 'logo', start: 0.3, rise: 0 },
  { part: 'headline', start: 0.6, rise: 60 },
  { part: 'body', start: 1.3, rise: 40 },
];
const EASE = 0.8;

function camera(motion: Motion, frames: number) {
  const p = `(on/${frames - 1})`;
  const center = `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'`;
  if (motion === 'zoom-out') return `z='1.14-0.14*${p}':${center}`;
  if (motion === 'pan') return `z='1.14':x='(iw-iw/zoom)*${p}':y='ih/2-ih/zoom/2'`;
  return `z='1+0.14*${p}':${center}`;
}

// background: the story background image, or a clip (the AI video) that already moves.
export async function renderVideo(
  snapshot: Snapshot,
  options: { motion?: Motion; clip?: Buffer; seconds?: number } = {},
) {
  const seconds = options.seconds || VIDEO_SECONDS;
  const frames = Math.round(seconds * FPS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyloom-video-'));
  try {
    const inputs: string[] = [];
    let graph: string;
    if (options.clip) {
      const clip = path.join(dir, 'clip.mp4');
      fs.writeFileSync(clip, options.clip);
      inputs.push('-stream_loop', '-1', '-i', clip);
      graph = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS},setsar=1[bg0]`;
    } else {
      const background = path.join(dir, 'background.png');
      fs.writeFileSync(background, renderPng(snapshot, ['background']));
      inputs.push('-i', background);
      // Upscaling first keeps the zoom smooth instead of stepping a pixel at a time.
      graph = `[0:v]scale=2160:3840,zoompan=${camera(options.motion || 'zoom-in', frames)}:d=${frames}:s=1080x1920:fps=${FPS},setsar=1[bg0]`;
    }
    let last = 'bg0';
    let index = 1;
    for (const { part, start, rise } of entrances) {
      const visible =
        part === 'logo'
          ? snapshot.layout.logo.visible && !!snapshot.logoId
          : snapshot.layout[part].visible && !!snapshot.layout[part].text.trim();
      if (!visible) continue;
      const file = path.join(dir, `${part}.png`);
      fs.writeFileSync(file, renderPng(snapshot, [part]));
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', file);
      const eased = `${rise}*pow(1-clip((t-${start})/${EASE},0,1),3)`;
      graph += `;[${index}:v]format=rgba,fade=t=in:st=${start}:d=${EASE}:alpha=1[p${index}]`;
      graph += `;[${last}][p${index}]overlay=x=0:y='${eased}'[v${index}]`;
      last = `v${index}`;
      index++;
    }
    graph += `;[${last}]format=yuv420p[out]`;
    const output = path.join(dir, 'story.mp4');
    await ffmpeg([
      ...inputs,
      '-filter_complex',
      graph,
      '-map',
      '[out]',
      '-t',
      String(seconds),
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '19',
      '-profile:v',
      'high',
      '-movflags',
      '+faststart',
      '-an',
      output,
    ]);
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
