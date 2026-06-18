// Offline isometric preview of the *actual* generated world. Reuses the server's
// World class so the image reflects real terrain, then encodes a PNG with zero
// image dependencies (manual PNG via Node's zlib). Lets you see the world on a
// device that can't run the game.

import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { World } from "../server/world";
import { BlockType, BLOCKS } from "../shared/blocks";
import { WORLD_HEIGHT } from "../shared/constants";

const SEED = Number(process.env.SEED ?? 837022);
const N = 56; // region edge in blocks
const X0 = -10;
const Z0 = -10;

// Isometric tile geometry (pixels).
const HW = 14; // half tile width
const HH = 7; // half tile height
const BH = 5; // vertical pixels per world-height unit
const SIDE = 10; // drawn block thickness

const world = new World(SEED);

interface Col {
  x: number;
  z: number;
  top: number;
  block: BlockType;
  water: boolean;
}

// Find the visible surface of each column: highest solid/foliage block, or a
// water tile when a lake sits above the floor.
function columnAt(wx: number, wz: number): Col {
  let topSolid = 0;
  let topSolidBlock = BlockType.Bedrock;
  let waterTop = -1;
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const b = world.getBlock(wx, y, wz);
    if (b === BlockType.Air) continue;
    if (b === BlockType.Water) {
      if (waterTop < 0) waterTop = y;
      continue;
    }
    topSolid = y;
    topSolidBlock = b;
    break;
  }
  if (waterTop > topSolid) {
    return { x: wx, z: wz, top: waterTop, block: BlockType.Water, water: true };
  }
  return { x: wx, z: wz, top: topSolid, block: topSolidBlock, water: false };
}

const cols: Col[] = [];
for (let dx = 0; dx < N; dx++) {
  for (let dz = 0; dz < N; dz++) {
    cols.push(columnAt(X0 + dx, Z0 + dz));
  }
}

// Project a column's top-center to screen space.
function project(c: Col): { sx: number; sy: number } {
  const lx = c.x - X0;
  const lz = c.z - Z0;
  return { sx: (lx - lz) * HW, sy: (lx + lz) * HH - c.top * BH };
}

// Compute bounds for canvas sizing.
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const c of cols) {
  const { sx, sy } = project(c);
  minX = Math.min(minX, sx - HW);
  maxX = Math.max(maxX, sx + HW);
  minY = Math.min(minY, sy - HH);
  maxY = Math.max(maxY, sy + HH + SIDE);
}
const MARGIN = 30;
const W = Math.ceil(maxX - minX) + MARGIN * 2;
const H = Math.ceil(maxY - minY) + MARGIN * 2;
const offX = -minX + MARGIN;
const offY = -minY + MARGIN;

// RGB framebuffer, sky-blue background.
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  buf[i * 3] = 0x8f;
  buf[i * 3 + 1] = 0xc7;
  buf[i * 3 + 2] = 0xff;
}

function setPx(x: number, y: number, r: number, g: number, b: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

// Fill a convex polygon by scanlines.
function fillPoly(pts: [number, number][], r: number, g: number, b: number): void {
  let yMin = Infinity, yMax = -Infinity;
  for (const p of pts) {
    yMin = Math.min(yMin, p[1]);
    yMax = Math.max(yMax, p[1]);
  }
  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) {
    let xL = Infinity, xR = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const [ax, ay] = a;
      const [cx, cy] = c;
      if (ay === cy) continue;
      if (y < Math.min(ay, cy) || y > Math.max(ay, cy)) continue;
      const t = (y - ay) / (cy - ay);
      const x = ax + (cx - ax) * t;
      xL = Math.min(xL, x);
      xR = Math.max(xR, x);
    }
    for (let x = Math.ceil(xL); x <= Math.floor(xR); x++) setPx(x, y, r, g, b);
  }
}

function shade(color: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.min(255, Math.round(color[0] * 255 * factor)),
    Math.min(255, Math.round(color[1] * 255 * factor)),
    Math.min(255, Math.round(color[2] * 255 * factor)),
  ];
}

// Painter's order: increasing (x+z) draws nearer/lower tiles last (on top).
cols.sort((a, b) => a.x + a.z - (b.x + b.z) || a.top - b.top);

for (const c of cols) {
  const { sx, sy } = project(c);
  const cx = sx + offX;
  const cy = sy + offY;
  const base = BLOCKS[c.block].color;

  // Hillshade the top face by relative height for definition.
  const heightFactor = 0.78 + (c.top / WORLD_HEIGHT) * 0.5;
  const [tr, tg, tb] = shade(base, Math.min(1.15, heightFactor));
  // Top diamond.
  fillPoly([[cx, cy - HH], [cx + HW, cy], [cx, cy + HH], [cx - HW, cy]], tr, tg, tb);

  // Left and right side faces (darker) give the blocks solidity.
  const [lr, lg, lb] = shade(base, 0.55);
  fillPoly([[cx - HW, cy], [cx, cy + HH], [cx, cy + HH + SIDE], [cx - HW, cy + SIDE]], lr, lg, lb);
  const [rr, rg, rb] = shade(base, 0.4);
  fillPoly([[cx, cy + HH], [cx + HW, cy], [cx + HW, cy + SIDE], [cx, cy + HH + SIDE]], rr, rg, rb);
}

// ---- minimal PNG encoder (truecolor, 8-bit) ----
function crc32(data: Buffer): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB
// (compression, filter, interlace already 0)

// Build raw scanlines with filter byte 0.
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = process.env.OUT ?? "world-preview.png";
writeFileSync(out, png);
console.log(`wrote ${out} (${W}x${H}, seed ${SEED})`);
