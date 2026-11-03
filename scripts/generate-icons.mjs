import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Minimal deterministic PNG encoder keeps icon generation independent of image tooling.
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function icon(size) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const green = ((u - 0.5) / 0.264) ** 2 + ((v - 0.707) / 0.078) ** 2 <= 1;
      const pole = u >= 0.477 && u <= 0.508 && v >= 0.277 && v <= 0.688;
      const flag = u >= 0.508 && u <= 0.72 && v >= 0.285 + (u - 0.508) * 0.38 && v <= 0.451 - (u - 0.508) * 0.4;
      const hole = (u - 0.596) ** 2 + (v - 0.672) ** 2 <= 0.025 ** 2;
      const color = (green || pole || flag) && !hole ? [247, 244, 239] : [177, 31, 75];
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = color[channel];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [file, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(`../public/icons/${file}`, import.meta.url), icon(size));
}
