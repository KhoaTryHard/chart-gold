/**
 * Kim Tuyến — Nét vàng
 * Regenerate from the project root: node scripts/generate-brand-assets.mjs
 * Uses only the project's installed Next.js (fontkit + Geist) and Sharp.
 * All lettering is converted to outlines, so SVGs render without installed fonts.
 * This script writes only the named brand assets; it preserves preview.html.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const createFont = require('next/dist/compiled/@next/font/dist/fontkit').default;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'brand');
const font = createFont(await readFile(require.resolve('next/dist/compiled/@vercel/og/Geist-Regular.ttf')));
const c = {
  ink: '#20251F', gold: '#A78646', ivory: '#F7F6F2', muted: '#73796F',
  softgold: '#E8DCC2', lightgold: '#D9BD80', line: '#DFE1D9', darkline: '#42473C',
};
const inventory = [];
await mkdir(out, { recursive: true });

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const n = (value) => Number(value.toFixed(4));
function svg(width, height, title, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${esc(title)}</title>${content}</svg>\n`;
}

// Shared master geometry. Keep in sync with the site's BrandMark component.
function mark(fill = c.gold) {
  return `<g fill="${fill}"><rect x="12" y="12" width="9" height="40" rx="0.8"/><path d="M26 27 41 12H53L33 32Z"/><path d="M26 37 33 32 53 52H41Z"/></g>`;
}
function placeMark(x, y, size, fill) {
  return `<g transform="translate(${x} ${y}) scale(${n(size / 64)})">${mark(fill)}</g>`;
}
function text(value, x, baseline, size, fill = c.ink, tracking = 0, emphasis = false) {
  const run = font.layout(value);
  let cursor = 0;
  const paths = run.glyphs.map((glyph, i) => {
    if (glyph.id === 0) throw new Error(`Geist is missing a glyph in: ${value}`);
    const p = run.positions[i];
    const path = glyph.path.toSVG();
    const item = path ? `<path d="${path}" transform="translate(${n(cursor + p.xOffset)} ${n(p.yOffset)})"/>` : '';
    cursor += p.xAdvance + tracking * font.unitsPerEm / size;
    return item;
  }).join('');
  return `<g aria-label="${esc(value)}" fill="${fill}"${emphasis ? ` stroke="${fill}" stroke-width="5" stroke-linejoin="round"` : ''} transform="translate(${x} ${baseline}) scale(${n(size / font.unitsPerEm)} ${n(-size / font.unitsPerEm)})">${paths}</g>`;
}
function lockup(x = 0, y = 0, scale = 1, reverse = false, mono = false) {
  const fg = reverse ? c.ivory : c.ink;
  return `<g transform="translate(${x} ${y}) scale(${scale})">${placeMark(8, 10, 68, mono ? fg : reverse ? c.lightgold : c.gold)}${text('Kim Tuyến', 94, 48, 46, fg, -0.8, true)}${text('GIÁ VÀNG VIỆT NAM', 97, 71, 11.3, mono ? fg : reverse ? c.lightgold : c.muted, 2.1)}</g>`;
}
function avatar(maskable = false) {
  return svg(64, 64, 'Kim Tuyến — biểu tượng Nét vàng', `<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="${c.ink}"/>${maskable ? `<g transform="translate(7.04 7.04) scale(.78)">${mark(c.lightgold)}</g>` : mark(c.lightgold)}`);
}
const line = (x1, y1, x2, y2, stroke = c.line, opacity = 1) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-opacity="${opacity}" fill="none"/>`;

async function saveSvg(name, width, height, title, content, png = false) {
  const data = svg(width, height, title, content);
  await writeFile(join(out, `${name}.svg`), data);
  inventory.push({ file: `/brand/${name}.svg`, width, height, description: title });
  if (png) {
    await sharp(Buffer.from(data)).png({ compressionLevel: 9 }).toFile(join(out, `${name}.png`));
    inventory.push({ file: `/brand/${name}.png`, width, height, description: title });
  }
  return data;
}

for (const [name, color] of [['primary', c.gold], ['reverse', c.lightgold], ['mono', c.ink]]) {
  await saveSvg(`mark-${name}`, 64, 64, `Kim Tuyến — biểu trưng ${name}`, mark(color));
  await saveSvg(`logo-${name}`, 360, 88, `Kim Tuyến — logo ${name}`, lockup(0, 0, 1, name === 'reverse', name === 'mono'), true);
}
await writeFile(join(out, 'avatar.svg'), avatar());
inventory.push({ file: '/brand/avatar.svg', width: 64, height: 64, description: 'Biểu tượng ứng dụng nền mực' });
await sharp(Buffer.from(avatar())).resize(512, 512).png().toFile(join(out, 'avatar.png'));
inventory.push({ file: '/brand/avatar.png', width: 512, height: 512, description: 'Ảnh đại diện' });
for (const size of [192, 512]) {
  for (const maskable of [false, true]) {
    const name = `icon-${maskable ? 'maskable-' : ''}${size}.png`;
    await sharp(Buffer.from(avatar(maskable))).resize(size, size).png().toFile(join(out, name));
    inventory.push({ file: `/brand/${name}`, width: size, height: size, purpose: maskable ? 'maskable' : 'any', description: 'Biểu tượng PWA' });
  }
}
await writeFile(join(root, 'public', 'favicon.svg'), avatar());
await sharp(Buffer.from(avatar())).resize(180, 180).png().toFile(join(root, 'public', 'apple-touch-icon.png'));
// A standard ICO directory with PNG-compressed 16, 32 and 48 px images.
const iconSizes = [16, 32, 48];
const iconBuffers = await Promise.all(iconSizes.map((size) => sharp(Buffer.from(avatar())).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + iconBuffers.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(iconBuffers.length, 4);
let offset = header.length;
iconBuffers.forEach((buffer, i) => {
  const start = 6 + i * 16;
  header[start] = header[start + 1] = iconSizes[i];
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(buffer.length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += buffer.length;
});
await writeFile(join(root, 'public', 'favicon.ico'), Buffer.concat([header, ...iconBuffers]));

function motif(x, y, scale = 1, dark = false) {
  const soft = dark ? c.darkline : c.line;
  const gold = dark ? c.lightgold : c.gold;
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M0 72H432M0 168H432M0 264H432M72 0V336M216 0V336M360 0V336" fill="none" stroke="${soft}"/>
    <path d="M72 264V72H108V264ZM144 144 216 72H288L180 180ZM144 216 180 180 288 264H216Z" fill="${dark ? '#2B3027' : c.softgold}"/>
    ${placeMark(143, 75, 225, gold)}
    <circle cx="72" cy="72" r="3" fill="${gold}"/><circle cx="360" cy="264" r="3" fill="${gold}"/>
  </g>`;
}

const bannerSpecs = [
  { name: 'market', title: 'Bảng giá vàng', label: 'BẢNG GIÁ VÀNG', lines: ['Hiểu giá vàng.', 'Vững góc nhìn.'], copy: 'Theo dõi giá vàng Việt Nam trong một góc nhìn rõ ràng.', dark: false },
  { name: 'editorial', title: 'Nhịp vàng', label: 'NHỊP VÀNG', lines: ['Theo nhịp thị trường.', 'Giữ góc nhìn riêng.'], copy: 'Tin tức & góc nhìn cho người theo dõi vàng.', dark: true },
  { name: 'tools', title: 'Công cụ vàng', label: 'CÔNG CỤ VÀNG', lines: ['Đặt con số', 'vào đúng bối cảnh.'], copy: 'Quy đổi, so sánh và tính toán trước mỗi quyết định.', dark: false },
];
for (const b of bannerSpecs) {
  const bg = b.dark ? c.ink : c.ivory;
  const fg = b.dark ? c.ivory : c.ink;
  const subdued = b.dark ? c.lightgold : c.muted;
  const content = `<rect width="1600" height="560" fill="${bg}"/>
    ${lockup(64, 35, 0.92, b.dark)}
    ${text(b.label, 76, 186, 13, b.dark ? c.lightgold : c.gold, 2.5)}
    ${text(b.lines[0], 73, 281, 67, fg, -2, true)}
    ${text(b.lines[1], 73, 363, 67, fg, -2, true)}
    ${text(b.copy, 77, 414, 19, subdued)}
    ${motif(1040, 110, 1, b.dark)}
    ${line(76, 477, 1524, 477, b.dark ? c.darkline : c.line)}
    ${text('vanghomnay.online', 77, 518, 15, subdued)}
    ${text('KIM TUYẾN', 1408, 518, 11, subdued, 1.7)}
  `;
  await saveSvg(`banner-${b.name}`, 1600, 560, `Kim Tuyến — banner ${b.title}`, content, true);
}

const socialContent = `<rect width="1200" height="630" fill="${c.ink}"/>
  ${lockup(52, 37, 0.98, true)}
  ${line(66, 165, 1134, 165, c.darkline)}
  ${text('DỮ LIỆU & GÓC NHÌN VỀ VÀNG', 68, 225, 13, c.lightgold, 2)}
  ${text('Giá vàng rõ ràng.', 63, 323, 67, c.ivory, -2, true)}
  ${text('Góc nhìn vững vàng.', 63, 402, 67, c.ivory, -2, true)}
  ${text('Bảng giá  ·  Nhịp vàng  ·  Công cụ', 68, 465, 20, c.lightgold)}
  <path d="M885 226H1134M885 474H1134" fill="none" stroke="${c.darkline}"/>
  ${placeMark(866, 216, 282, c.lightgold)}
  ${line(66, 533, 1134, 533, c.darkline)}
  ${text('vanghomnay.online', 68, 578, 18, c.ivory)}
  ${text('KIM TUYẾN', 1005, 578, 12, c.lightgold, 1.7)}
`;
await saveSvg('social-card', 1200, 630, 'Kim Tuyến — giá vàng rõ ràng, góc nhìn vững vàng', socialContent, true);
await writeFile(join(root, 'public', 'og.png'), await readFile(join(out, 'social-card.png')));

await saveSvg('social-square', 1080, 1080, 'Kim Tuyến — giá vàng và góc nhìn', `<rect width="1080" height="1080" fill="${c.ivory}"/>
  ${lockup(63, 54, 1.13)}
  ${text('DỮ LIỆU & GÓC NHÌN VỀ VÀNG', 78, 240, 15, c.gold, 2.2)}
  ${text('Giá vàng.', 70, 359, 105, c.ink, -3.5, true)}
  ${text('Góc nhìn.', 70, 474, 105, c.ink, -3.5, true)}
  ${text('Niềm tin từ dữ liệu.', 78, 542, 33, c.muted, -0.5)}
  ${motif(520, 560, 1.08)}
  ${text('Bảng giá', 78, 736, 21, c.ink)}
  ${text('Nhịp vàng', 78, 778, 21, c.ink)}
  ${text('Công cụ vàng', 78, 820, 21, c.ink)}
  ${line(78, 956, 1002, 956)}
  ${text('vanghomnay.online', 78, 1008, 20, c.ink)}
  ${text('KIM TUYẾN', 865, 1008, 12, c.gold, 1.7)}
`, true);

await saveSvg('motif', 432, 336, 'Nét vàng — họa tiết hình học', motif(0, 0));
await saveSvg('pattern', 640, 320, 'Nét vàng — nền họa tiết liền mạch', `<defs><pattern id="net-vang" width="160" height="160" patternUnits="userSpaceOnUse"><path d="M0 80H160M80 0V160M24 56V104M64 80 88 56H104M64 80 88 104H104" fill="none" stroke="${c.gold}" stroke-opacity=".18" stroke-width="1"/><circle cx="80" cy="80" r="2" fill="${c.gold}" fill-opacity=".25"/></pattern></defs><rect width="640" height="320" fill="url(#net-vang)"/>`);

await writeFile(join(out, 'assets.json'), `${JSON.stringify({
  brand: 'Kim Tuyến', concept: 'Nét vàng', palette: c,
  source: 'scripts/generate-brand-assets.mjs',
  typeface: 'Geist Regular, bundled with Next.js; SVG lettering is outlined',
  generatedAssets: inventory,
  rootAssets: ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/og.png'],
}, null, 2)}\n`);

// A compact visual proof sheet, generated from the actual deliverables.
const proofItems = [
  { file: 'logo-primary.png', x: 28, y: 28, width: 360, height: 88 },
  { file: 'avatar.png', x: 522, y: 31, width: 72, height: 72 },
  { file: 'banner-market.png', x: 28, y: 146, width: 800, height: 280 },
  { file: 'banner-editorial.png', x: 28, y: 444, width: 800, height: 280 },
  { file: 'banner-tools.png', x: 28, y: 742, width: 800, height: 280 },
  { file: 'social-card.png', x: 854, y: 146, width: 600, height: 315 },
  { file: 'social-square.png', x: 854, y: 484, width: 538, height: 538 },
];
const proofLayers = await Promise.all(proofItems.map(async (item) => ({
  input: await sharp(join(out, item.file)).resize(item.width, item.height).toBuffer(),
  left: item.x, top: item.y,
})));
await sharp({ create: { width: 1482, height: 1050, channels: 4, background: '#EBEDE6' } }).composite(proofLayers).png().toFile(join(out, 'contact-sheet.png'));
console.log(`Generated ${inventory.length + 7} Kim Tuyến brand files. Preview: public/brand/contact-sheet.png`);
