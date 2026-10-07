import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dataDir, id, now, one, run } from './db';
import { AppError, requireValue } from './errors';
import type { FileStorage } from './types';
const directory = path.join(dataDir, 'assets');
fs.mkdirSync(directory, { recursive: true });
export const localStorage: FileStorage = {
  put(bytes, mime, kind, width, height) {
    const assetId = id();
    const filename = `${assetId}.${mime === 'image/svg+xml' ? 'svg' : mime === 'font/ttf' ? 'ttf' : 'png'}`;
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
      kind === 'logo' ? new Date(Date.now() + 3600000).toISOString() : null,
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
