import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { dataDir, id, now, one, run } from './db';
import { AppError, requireValue } from './errors';
import type { FileStorage } from './types';
const directory = path.join(dataDir, 'assets');
fs.mkdirSync(directory, { recursive: true });
export const localStorage: FileStorage = {
  put(bytes, mime, kind, width, height) {
    const assetId = id();
    const extension =
      { 'image/svg+xml': 'svg', 'font/ttf': 'ttf', 'font/otf': 'otf', 'image/jpeg': 'jpg' }[mime] ||
      'png';
    const filename = `${assetId}.${extension}`;
    fs.writeFileSync(path.join(directory, filename), bytes);
    run(
      'INSERT INTO assets VALUES(?,?,?,?,?,?,?)',
      assetId,
      filename,
      mime,
      width,
      height,
      kind,
      now(),
    );
    run(
      'INSERT INTO asset_cleanup_candidates VALUES(?,?,?)',
      assetId,
      now(),
      kind === 'logo' || kind === 'brand-font' || kind === 'brand-photo'
        ? new Date(Date.now() + 3600000).toISOString()
        : null,
    );
    return assetId;
  },
  read(assetId) {
    const asset = requireValue(
      one<{ filename: string; mime: string; width: number; height: number }>(
        'SELECT * FROM assets WHERE id=?',
        assetId,
      ),
      'Asset not found',
    );
    return { ...asset, bytes: fs.readFileSync(path.join(directory, asset.filename)) };
  },
};
export function assetPath(assetId: string) {
  const asset = requireValue(
    one<{ filename: string }>('SELECT filename FROM assets WHERE id=?', assetId),
  );
  return path.join(directory, asset.filename);
}
export async function uploadLogo(bytes: Buffer, mime: string) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || bytes.length > 5 * 1024 * 1024)
    throw new AppError('Upload a PNG, JPEG, or WebP logo smaller than 5 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000 });
    const info = await image.metadata();
    if (!info.format || !['png', 'jpeg', 'webp'].includes(info.format))
      throw new Error('Unsupported actual image format');
    if (!info.width || !info.height) throw new Error('No dimensions');
    const normalized = await image.rotate().png().toBuffer();
    const meta = await sharp(normalized).metadata();
    return localStorage.put(normalized, 'image/png', 'logo', meta.width!, meta.height!);
  } catch {
    throw new AppError('This image could not be read. Try another PNG, JPEG, or WebP.');
  }
}

// The brand's own photos for story backgrounds, stored at story size as JPEG.
export async function uploadBrandPhoto(bytes: Buffer) {
  if (bytes.length > 20 * 1024 * 1024) throw new AppError('Choose a photo smaller than 20 MB.');
  try {
    const normalized = await sharp(bytes, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize(1440, 2560, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    const meta = await sharp(normalized).metadata();
    return localStorage.put(normalized, 'image/jpeg', 'brand-photo', meta.width!, meta.height!);
  } catch {
    throw new AppError('This photo could not be read. Use JPEG, PNG, or WebP.');
  }
}

// Post photos arrive as base64 data from the browser; re-encoding them through sharp
// rejects anything that is not a real image and keeps each one small for the AI request.
export async function normalizePhoto(data: string) {
  try {
    return await sharp(Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64'), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AppError('A photo could not be read. Use JPEG or PNG images.');
  }
}

// Brand fonts must be single TrueType or OpenType files, the formats the story renderer reads.
export function uploadFont(bytes: Buffer) {
  const signature = bytes.subarray(0, 4).toString('latin1');
  const otf = signature === 'OTTO';
  if (bytes.length > 10 * 1024 * 1024) throw new AppError('Choose a font file smaller than 10 MB.');
  if (!otf && signature !== '\0\x01\0\0' && signature !== 'true')
    throw new AppError(
      'Upload a .ttf or .otf font file. WOFF and font collections are not supported.',
    );
  const family = readFamily(bytes);
  const id = localStorage.put(bytes, otf ? 'font/otf' : 'font/ttf', 'brand-font', 0, 0);
  return { id, family };
}
export function readFamily(bytes: Buffer) {
  try {
    const font = fontkit.create(bytes) as fontkit.Font;
    const family = font.familyName?.trim();
    if (!family || !font.glyphForCodePoint(0x41)?.id) throw new Error('No usable glyphs');
    return family;
  } catch {
    throw new AppError('This font could not be read. Try another .ttf or .otf file.');
  }
}
