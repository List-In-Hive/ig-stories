import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
// Convert the bundled open-source WOFF font tables to SFNT for the native PNG renderer.
function convert(input) {
  const count = input.readUInt16BE(12),
    tables = [];
  let offset = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20,
      start = input.readUInt32BE(at + 4),
      compressed = input.readUInt32BE(at + 8),
      length = input.readUInt32BE(at + 12);
    const raw = input.subarray(start, start + compressed),
      data = compressed < length ? inflateSync(raw) : raw;
    tables.push({
      tag: input.subarray(at, at + 4),
      checksum: input.readUInt32BE(at + 16),
      offset,
      data,
    });
    offset += (length + 3) & ~3;
  }
  const result = Buffer.alloc(offset);
  input.copy(result, 0, 4, 8);
  result.writeUInt16BE(count, 4);
  const power = Math.floor(Math.log2(count));
  result.writeUInt16BE(2 ** power * 16, 6);
  result.writeUInt16BE(power, 8);
  result.writeUInt16BE(count * 16 - 2 ** power * 16, 10);
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    table.tag.copy(result, at);
    result.writeUInt32BE(table.checksum, at + 4);
    result.writeUInt32BE(table.offset, at + 8);
    result.writeUInt32BE(table.data.length, at + 12);
    table.data.copy(result, table.offset);
  });
  return result;
}
fs.mkdirSync('public/fonts', { recursive: true });
for (const family of ['inter', 'lora', 'montserrat'])
  fs.copyFileSync(
    path.join('node_modules', '@fontsource', family, 'LICENSE'),
    `public/fonts/${family}-LICENSE.txt`,
  );
for (const [family, weight, name] of [
  ['inter', 400, 'Inter'],
  ['inter', 700, 'Inter-Bold'],
  ['lora', 400, 'Lora'],
  ['lora', 700, 'Lora-Bold'],
  ['montserrat', 400, 'Montserrat'],
  ['montserrat', 700, 'Montserrat-Bold'],
  ['montserrat', 800, 'Montserrat-ExtraBold'],
  ['montserrat', 900, 'Montserrat-Black'],
]) {
  const source = path.join(
    'node_modules',
    '@fontsource',
    family,
    'files',
    `${family}-latin-${weight}-normal.woff`,
  );
  fs.writeFileSync(`public/fonts/${name}.ttf`, convert(fs.readFileSync(source)));
}
console.log('Prepared bundled Montserrat, Inter, and Lora fonts.');
