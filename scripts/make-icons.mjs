// Generates icons/*.png (dumbbell glyph) with no dependencies: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x12, 0x13, 0x15];
const FG = [0x6f, 0xd6, 0xa8]; // ≈ oklch(0.8 0.11 160), the app accent

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Rounded rectangles in a unit square (0..1), centred horizontally. Glyph stays in the central 60% (maskable-safe).
const R = (cx, cy, w, h, r) => ({ cx, cy, w, h, r });
const SHAPES = [
  R(0.5, 0.5, 0.36, 0.07, 0.035),   // bar
  R(0.29, 0.5, 0.08, 0.34, 0.03),   // inner plates
  R(0.71, 0.5, 0.08, 0.34, 0.03),
  R(0.215, 0.5, 0.06, 0.22, 0.025), // outer plates
  R(0.785, 0.5, 0.06, 0.22, 0.025)
];
function inside(x, y) {
  for (const s of SHAPES) {
    const dx = Math.max(Math.abs(x - s.cx) - (s.w / 2 - s.r), 0);
    const dy = Math.max(Math.abs(y - s.cy) - (s.h / 2 - s.r), 0);
    if (dx * dx + dy * dy <= s.r * s.r) return true;
  }
  return false;
}
function draw(size) {
  const buf = Buffer.alloc(size * size * 3);
  const SS = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hit++;
    const a = hit / (SS * SS), i = (y * size + x) * 3;
    for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
  }
  return png(size, buf);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const [name, size] of [['apple-touch-icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), draw(size));
  console.log('icons/' + name);
}
