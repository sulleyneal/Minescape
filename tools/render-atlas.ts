// Renders the procedural texture atlas to a labelled PNG so the in-browser
// block textures can be previewed on any device. Uses node-canvas (a dev-only
// convenience; the game itself needs no image assets).
//
//   npx tsx tools/render-atlas.ts

import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { drawTile, NUM_TILES, TILE, TILE_INDEX } from "../client/src/atlasDraw";

const NAMES: Record<number, string> = {
  [TILE_INDEX.grassTop]: "Grass top",
  [TILE_INDEX.grassSide]: "Grass side",
  [TILE_INDEX.dirt]: "Dirt",
  [TILE_INDEX.stone]: "Stone",
  [TILE_INDEX.sand]: "Sand",
  [TILE_INDEX.water]: "Water",
  [TILE_INDEX.logTop]: "Log top",
  [TILE_INDEX.logSide]: "Log side",
  [TILE_INDEX.leaves]: "Leaves",
  [TILE_INDEX.coal]: "Coal ore",
  [TILE_INDEX.iron]: "Iron ore",
  [TILE_INDEX.gold]: "Gold ore",
  [TILE_INDEX.plank]: "Plank",
  [TILE_INDEX.bedrock]: "Bedrock",
  [TILE_INDEX.moss]: "Mossy stone",
  [TILE_INDEX.rune]: "Runestone",
  [TILE_INDEX.crystal]: "Aether crystal",
  [TILE_INDEX.sapling]: "Sapling",
  [TILE_INDEX.snow]: "Snow",
  [TILE_INDEX.tallGrass]: "Tall grass",
  [TILE_INDEX.flower]: "Aether bloom",
  [TILE_INDEX.deadBush]: "Dead bush",
  [TILE_INDEX.cactusSide]: "Cactus side",
  [TILE_INDEX.cactusTop]: "Cactus top",
};

// First draw the raw atlas with the real game code, then sample tiles from it
// onto a larger labelled sheet.
const atlasCols = 6;
const atlasRows = 4;
const atlas = createCanvas(atlasCols * TILE, atlasRows * TILE);
const actx = atlas.getContext("2d") as unknown as CanvasRenderingContext2D;
for (let i = 0; i < NUM_TILES; i++) drawTile(actx, i);

const SCALE = 64;
const PAD = 16;
const LABEL = 22;
const cols = 6;
const count = NUM_TILES;
const rows = Math.ceil(count / cols);
const W = cols * (SCALE + PAD) + PAD;
const H = rows * (SCALE + PAD + LABEL) + PAD;

const sheet = createCanvas(W, H);
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#1a1f2b";
ctx.fillRect(0, 0, W, H);
ctx.imageSmoothingEnabled = false; // crisp pixel scaling

for (let i = 0; i < count; i++) {
  const gx = i % cols;
  const gy = Math.floor(i / cols);
  const x = PAD + gx * (SCALE + PAD);
  const y = PAD + gy * (SCALE + PAD + LABEL);
  const sx = (i % atlasCols) * TILE;
  const sy = Math.floor(i / atlasCols) * TILE;
  ctx.drawImage(atlas, sx, sy, TILE, TILE, x, y, SCALE, SCALE);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(x + 0.5, y + 0.5, SCALE, SCALE);
  ctx.fillStyle = "#dfe6f0";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(NAMES[i] ?? `#${i}`, x + SCALE / 2, y + SCALE + 15);
}

const out = process.env.OUT ?? "texture-atlas.png";
writeFileSync(out, sheet.toBuffer("image/png"));
console.log(`wrote ${out} (${W}x${H})`);
