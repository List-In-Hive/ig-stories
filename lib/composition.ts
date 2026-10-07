import fs from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';
import { Resvg } from '@resvg/resvg-js';
import type { Layout, Project, Script, Snapshot, Layer } from './types';
import { localStorage, assetPath } from './storage';
import { createHash } from 'node:crypto';
import { setting, setSetting } from './db';
import { AppError } from './errors';
export const fontFiles = [
  'Inter',
  'Inter-Bold',
  'Lora',
  'Lora-Bold',
  'Montserrat',
  'Montserrat-Bold',
].map((name) => path.join(process.cwd(), 'public/fonts', `${name}.ttf`));
const fonts = new Map<string, fontkit.Font>();
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
// The uploaded brand font is used only when this snapshot carries it; otherwise Inter stands in.
function fontName(layer: Layer, snapshot?: Snapshot) {
  return layer.font === 'Brand' && !snapshot?.fontAssets?.Brand ? 'Inter' : layer.font;
}
function fontFor(layer: Layer, bold: boolean, snapshot?: Snapshot) {
  const base = fontName(layer, snapshot),
    name = `${base}${bold ? '-Bold' : ''}`,
    assetId = snapshot?.fontAssets?.[name] || (base === 'Brand' ? snapshot?.fontAssets?.Brand : ''),
    key = assetId || name;
  if (!fonts.has(key))
    fonts.set(
      key,
      assetId
        ? (fontkit.create(localStorage.read(assetId).bytes) as fontkit.Font)
        : (fontkit.openSync(
            path.join(process.cwd(), 'public/fonts', name + '.ttf'),
          ) as fontkit.Font),
    );
  return fonts.get(key)!;
}
// The family name the renderer matches: the name inside the brand font file, or the built-in name.
function familyFor(layer: Layer, bold: boolean, snapshot: Snapshot) {
  const base = fontName(layer, snapshot);
  if (base !== 'Brand') return base;
  const brand = snapshot.project.brandFont!;
  return (bold && brand.bold ? brand.bold : brand.regular).family.replace(/['"\\<>&]/g, '');
}
export function snapshotFonts(project?: Project) {
  const builtIn = Object.fromEntries(
    fontFiles.map((file) => {
      const bytes = fs.readFileSync(/* turbopackIgnore: true */ file),
        key = 'font:' + createHash('sha256').update(bytes).digest('hex');
      let assetId = setting(key, '');
      if (!assetId) {
        assetId = localStorage.put(bytes, 'font/ttf', 'font', 0, 0);
        setSetting(key, assetId);
      }
      return [path.basename(file, '.ttf'), assetId];
    }),
  );
  const brand = project?.brandFont;
  if (!brand) return builtIn;
  return {
    ...builtIn,
    Brand: brand.regular.id,
    ...(brand.bold ? { 'Brand-Bold': brand.bold.id } : {}),
  };
}
export function wrap(layer: Layer, bold = false, snapshot?: Snapshot) {
  const font = fontFor(layer, bold, snapshot);
  const measure = (s: string) =>
    (font.layout(s).glyphs.reduce((sum, g) => sum + g.advanceWidth, 0) / font.unitsPerEm) *
    layer.size;
  const lines: string[] = [];
  for (const paragraph of layer.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (measure(word) > layer.width)
        throw new AppError('A word cannot fit in the text box. Reduce its size or widen the box.');
      const next = line ? line + ' ' + word : word;
      if (measure(next) > layer.width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
export function defaultLayout(project: Project, script: Script): Layout {
  const layer = (text: string, y: number, size: number): Layer => ({
    text,
    x: 90,
    y,
    width: 900,
    size,
    color: '#172420',
    font: project.font,
    align: 'left',
    visible: !!text,
  });
  return {
    headline: layer(script.headline, 340, 88),
    body: layer(script.body, 670, 37),
    cta: layer(script.cta, 1650, 29),
    contact: layer(
      [project.website, project.email, project.phone, project.address, project.location]
        .filter(Boolean)
        .join(' · '),
      1730,
      23,
    ),
    logo: { x: 90, y: 150, width: 200, visible: !!project.logoId },
  };
}
export function validateComposition(snapshot: Snapshot) {
  const errors: string[] = [];
  for (const key of ['headline', 'body', 'cta', 'contact'] as const) {
    const layer = snapshot.layout[key];
    if (!layer.visible || !layer.text) continue;
    try {
      const lines = wrap(layer, key === 'headline', snapshot);
      if (
        layer.x < 60 ||
        layer.y < 100 ||
        layer.x + layer.width > 1020 ||
        layer.y + lines.length * layer.size * 1.25 > 1820
      )
        errors.push(
          `${key}: text extends outside the safe area. Reduce the font size or move the layer.`,
        );
    } catch (error) {
      errors.push(`${key}: ${(error as Error).message}`);
    }
  }
  const logo = snapshot.layout.logo;
  if (logo.visible && snapshot.logoId) {
    const asset = localStorage.read(snapshot.logoId);
    if (
      logo.x < 60 ||
      logo.y < 100 ||
      logo.x + logo.width > 1020 ||
      logo.y + (logo.width * asset.height) / asset.width > 1820
    )
      errors.push('Logo extends outside the safe area.');
  }
  return errors;
}
const uri = (assetId: string) => {
  const asset = localStorage.read(assetId);
  return `data:${asset.mime};base64,${asset.bytes.toString('base64')}`;
};
// Every font a story can use: the files frozen into the snapshot, plus built-ins added later.
function fontFaces(snapshot: Snapshot) {
  const brand = snapshot.project?.brandFont;
  const assets = snapshot.fontAssets || {};
  const builtIn = fontFiles
    .filter((file) => !assets[path.basename(file, '.ttf')])
    .map((file) => ({
      family: path.basename(file, '.ttf').replace('-Bold', ''),
      weight: file.includes('Bold') ? 700 : 400,
      file,
    }));
  const frozen = Object.entries(assets).map(([name, assetId]) => {
    const bold = name.endsWith('-Bold');
    return {
      family: name.startsWith('Brand')
        ? (bold && brand?.bold ? brand.bold : brand!.regular).family
        : name.replace('-Bold', ''),
      weight: bold ? 700 : 400,
      file: assetPath(assetId),
    };
  });
  return [...frozen, ...builtIn];
}
export function renderSvg(snapshot: Snapshot) {
  const css = fontFaces(snapshot)
    .map(
      (face) =>
        `@font-face{font-family:'${face.family.replace(/['"\\<>&]/g, '')}';font-weight:${face.weight};src:url(data:font/${face.file.endsWith('.otf') ? 'otf' : 'ttf'};base64,${fs.readFileSync(/* turbopackIgnore: true */ face.file).toString('base64')});}`,
    )
    .join('');
  const layers = (['headline', 'body', 'cta', 'contact'] as const)
    .map((key) => {
      const layer = snapshot.layout[key];
      if (!layer.visible) return '';
      let lines: string[];
      try {
        lines = wrap(layer, key === 'headline', snapshot);
      } catch {
        lines = [layer.text];
      }
      const x =
        layer.align === 'center'
          ? layer.x + layer.width / 2
          : layer.align === 'right'
            ? layer.x + layer.width
            : layer.x;
      return `<text font-family="${xml(familyFor(layer, key === 'headline', snapshot))}" font-size="${layer.size}" font-weight="${key === 'headline' ? 700 : 400}" fill="${xml(layer.color)}" text-anchor="${layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start'}">${lines.map((line, i) => `<tspan x="${x}" y="${layer.y + layer.size + i * layer.size * 1.25}">${xml(line)}</tspan>`).join('')}</text>`;
    })
    .join('');
  const logo = snapshot.layout.logo;
  let logoSvg = '';
  if (logo.visible && snapshot.logoId) {
    const asset = localStorage.read(snapshot.logoId);
    logoSvg = `<image href="${uri(snapshot.logoId)}" x="${logo.x}" y="${logo.y}" width="${logo.width}" height="${(logo.width * asset.height) / asset.width}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><style>${css}</style><image href="${uri(snapshot.backgroundId)}" width="1080" height="1920"/>${logoSvg}${layers}</svg>`;
}
export function renderPng(snapshot: Snapshot) {
  const errors = validateComposition(snapshot);
  if (errors.length) throw new AppError(errors.join(' '));
  return Buffer.from(
    new Resvg(renderSvg(snapshot), {
      font: {
        loadSystemFonts: false,
        fontFiles: fontFaces(snapshot).map((face) => face.file),
      },
      fitTo: { mode: 'width', value: 1080 },
    })
      .render()
      .asPng(),
  );
}
