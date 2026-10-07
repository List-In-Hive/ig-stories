import sharp from 'sharp';
import { setting } from './db';
import { renderPng } from './composition';
import { getStory } from './services';
import type { Snapshot, Version } from './types';

export type ExportFormat = 'jpeg' | 'png';
// High-quality JPEG looks the same as PNG once Instagram recompresses it, at a fraction of the size.
export function exportFormat(): ExportFormat {
  return setting('exportFormat', process.env.EXPORT_FORMAT || 'jpeg') === 'png' ? 'png' : 'jpeg';
}
export async function renderStory(snapshot: Snapshot, format = exportFormat()) {
  const png = renderPng(snapshot);
  if (format === 'png') return { bytes: png, mime: 'image/png', extension: 'png' };
  // Full-resolution color (4:4:4) keeps small text edges crisp.
  const bytes = await sharp(png).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  return { bytes, mime: 'image/jpeg', extension: 'jpg' };
}
export function filename(version: Version, extension = 'png') {
  const project = version.data.project.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const story = getStory(version.storyId);
  return `${project}_${story.businessDate}_story-${story.slot || 1}-${story.id.slice(0, 8)}_v${version.revision}.${extension}`;
}
