// Brand palettes are stored as an ordered list of hex colors with fixed roles. Older projects
// saved three colors (background, accent, soft) before the text role existed.
export const PALETTE_ROLES = ['Background', 'Text', 'Accent', 'Secondary', 'Extra'] as const;
export const DEFAULT_TEXT = '#172420';

export function normalizePalette(colors: string[]) {
  return colors.length === 3 ? [colors[0], DEFAULT_TEXT, colors[1], colors[2]] : colors.slice(0, 5);
}
export function palette(colors: string[]) {
  const [background, text, accent, secondary, extra] = normalizePalette(colors);
  return { background, text, accent, secondary, extra: extra as string | undefined };
}
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Story text sits on a light-washed background; keep the brand color when it reads, else fall back.
export function readable(color: string, background: string, minimum = 4.5) {
  if (contrast(color, background) >= minimum) return color;
  return contrast(DEFAULT_TEXT, background) >= contrast('#ffffff', background)
    ? DEFAULT_TEXT
    : '#ffffff';
}
// Text for the image models: the text color is ours to draw, so it is left out of the artwork.
export function describePalette(colors: string[]) {
  const p = palette(colors);
  return [
    `background ${p.background}`,
    `accent ${p.accent}`,
    `secondary ${p.secondary}`,
    p.extra && `extra ${p.extra}`,
  ]
    .filter(Boolean)
    .join(', ');
}
