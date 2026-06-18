// Pure tile-drawing logic for the texture atlas — no Three.js or DOM globals,
// so it can run both in the browser (textures.ts) and in a Node renderer
// (tools/render-atlas.ts) that passes a node-canvas context.

import { BlockType } from "../../shared/blocks";

export const TILE = 16;
export const COLS = 6;
export const ROWS = 4;
export const ATLAS_W = COLS * TILE;
export const ATLAS_H = ROWS * TILE;

export const TILE_INDEX = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  water: 5,
  logTop: 6,
  logSide: 7,
  leaves: 8,
  coal: 9,
  iron: 10,
  gold: 11,
  plank: 12,
  bedrock: 13,
  moss: 14,
  rune: 15,
  crystal: 16,
};

function tile(i: number): { top: number; bottom: number; side: number } {
  return { top: i, bottom: i, side: i };
}

/** Per-block tile lookup: which atlas tile each face uses. */
export const BLOCK_TILES: Partial<Record<BlockType, { top: number; bottom: number; side: number }>> = {
  [BlockType.Grass]: { top: TILE_INDEX.grassTop, bottom: TILE_INDEX.dirt, side: TILE_INDEX.grassSide },
  [BlockType.Dirt]: tile(TILE_INDEX.dirt),
  [BlockType.Stone]: tile(TILE_INDEX.stone),
  [BlockType.Sand]: tile(TILE_INDEX.sand),
  [BlockType.Water]: tile(TILE_INDEX.water),
  [BlockType.Log]: { top: TILE_INDEX.logTop, bottom: TILE_INDEX.logTop, side: TILE_INDEX.logSide },
  [BlockType.Leaves]: tile(TILE_INDEX.leaves),
  [BlockType.CoalOre]: tile(TILE_INDEX.coal),
  [BlockType.IronOre]: tile(TILE_INDEX.iron),
  [BlockType.GoldOre]: tile(TILE_INDEX.gold),
  [BlockType.Plank]: tile(TILE_INDEX.plank),
  [BlockType.Bedrock]: tile(TILE_INDEX.bedrock),
  [BlockType.MossStone]: tile(TILE_INDEX.moss),
  [BlockType.Runestone]: tile(TILE_INDEX.rune),
  [BlockType.Crystal]: tile(TILE_INDEX.crystal),
};

// ---- tiny seeded RNG for repeatable noise per tile ----
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function fill(ctx: Ctx, ox: number, oy: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(ox, oy, TILE, TILE);
}

function speckle(ctx: Ctx, ox: number, oy: number, seed: number, amount: number, density = 0.5): void {
  const rand = rng(seed);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rand() > density) continue;
      const d = (rand() - 0.5) * amount;
      ctx.fillStyle = d > 0 ? `rgba(255,255,255,${d})` : `rgba(0,0,0,${-d})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function blobs(ctx: Ctx, ox: number, oy: number, seed: number, color: string, count: number, size: number): void {
  const rand = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * (TILE - size));
    const y = Math.floor(rand() * (TILE - size));
    const s = 1 + Math.floor(rand() * size);
    ctx.fillRect(ox + x, oy + y, s, s);
  }
}

export function drawTile(ctx: Ctx, index: number): void {
  const ox = (index % COLS) * TILE;
  const oy = Math.floor(index / COLS) * TILE;

  switch (index) {
    case TILE_INDEX.grassTop:
      fill(ctx, ox, oy, "#5a8f43");
      speckle(ctx, ox, oy, 11, 0.25, 0.6);
      blobs(ctx, ox, oy, 21, "#6fa653", 18, 2);
      blobs(ctx, ox, oy, 22, "#487a37", 10, 1);
      break;
    case TILE_INDEX.grassSide:
      fill(ctx, ox, oy, "#7a5a36");
      speckle(ctx, ox, oy, 31, 0.22);
      ctx.fillStyle = "#5a8f43";
      ctx.fillRect(ox, oy, TILE, 4);
      blobs(ctx, ox, oy + 3, 32, "#487a37", 8, 1);
      break;
    case TILE_INDEX.dirt:
      fill(ctx, ox, oy, "#7a5a36");
      speckle(ctx, ox, oy, 41, 0.25, 0.6);
      blobs(ctx, ox, oy, 42, "#5f4427", 8, 2);
      break;
    case TILE_INDEX.stone:
      fill(ctx, ox, oy, "#8a8a90");
      speckle(ctx, ox, oy, 51, 0.18, 0.7);
      blobs(ctx, ox, oy, 52, "#6f6f76", 6, 2);
      break;
    case TILE_INDEX.sand:
      fill(ctx, ox, oy, "#d9cb8c");
      speckle(ctx, ox, oy, 61, 0.15, 0.7);
      break;
    case TILE_INDEX.water:
      fill(ctx, ox, oy, "#2f6fd0");
      for (let y = 0; y < TILE; y += 4) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(ox, oy + y, TILE, 1);
      }
      break;
    case TILE_INDEX.logTop:
      fill(ctx, ox, oy, "#6b4a29");
      for (let r = 6; r > 0; r -= 2) {
        ctx.strokeStyle = r % 4 === 0 ? "#5a3d22" : "#7d5a33";
        ctx.strokeRect(ox + 8 - r, oy + 8 - r, r * 2, r * 2);
      }
      break;
    case TILE_INDEX.logSide:
      fill(ctx, ox, oy, "#6b4a29");
      for (let x = 1; x < TILE; x += 3) {
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(ox + x, oy, 1, TILE);
      }
      speckle(ctx, ox, oy, 71, 0.12);
      break;
    case TILE_INDEX.leaves:
      fill(ctx, ox, oy, "#3f7a32");
      blobs(ctx, ox, oy, 81, "#4f9140", 22, 3);
      blobs(ctx, ox, oy, 82, "#2f5e26", 18, 2);
      break;
    case TILE_INDEX.coal:
      fill(ctx, ox, oy, "#8a8a90");
      speckle(ctx, ox, oy, 51, 0.15, 0.6);
      blobs(ctx, ox, oy, 91, "#26262b", 8, 3);
      break;
    case TILE_INDEX.iron:
      fill(ctx, ox, oy, "#8a8a90");
      speckle(ctx, ox, oy, 51, 0.15, 0.6);
      blobs(ctx, ox, oy, 101, "#b5896b", 8, 3);
      break;
    case TILE_INDEX.gold:
      fill(ctx, ox, oy, "#8a8a90");
      speckle(ctx, ox, oy, 51, 0.15, 0.6);
      blobs(ctx, ox, oy, 111, "#e0bb45", 8, 3);
      break;
    case TILE_INDEX.plank:
      fill(ctx, ox, oy, "#b38d54");
      for (let y = 0; y < TILE; y += 5) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(ox, oy + y, TILE, 1);
      }
      speckle(ctx, ox, oy, 121, 0.1);
      break;
    case TILE_INDEX.bedrock:
      fill(ctx, ox, oy, "#2a2a30");
      blobs(ctx, ox, oy, 131, "#15151a", 16, 3);
      blobs(ctx, ox, oy, 132, "#3a3a44", 10, 2);
      break;
    case TILE_INDEX.moss:
      fill(ctx, ox, oy, "#8a8a90");
      speckle(ctx, ox, oy, 51, 0.15, 0.6);
      blobs(ctx, ox, oy, 141, "#4a7a45", 14, 3);
      blobs(ctx, ox, oy, 142, "#37663a", 8, 2);
      break;
    case TILE_INDEX.rune:
      fill(ctx, ox, oy, "#3a3658");
      speckle(ctx, ox, oy, 151, 0.12);
      ctx.strokeStyle = "#7fe6ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox + 4, oy + 3);
      ctx.lineTo(ox + 11, oy + 6);
      ctx.lineTo(ox + 6, oy + 12);
      ctx.stroke();
      break;
    case TILE_INDEX.crystal:
      fill(ctx, ox, oy, "#5fc7e0");
      ctx.fillStyle = "#a6ecff";
      ctx.beginPath();
      ctx.moveTo(ox + 8, oy + 1);
      ctx.lineTo(ox + 13, oy + 9);
      ctx.lineTo(ox + 8, oy + 15);
      ctx.lineTo(ox + 3, oy + 9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.stroke();
      break;
    default:
      fill(ctx, ox, oy, "#ff00ff");
  }
}

/** UV rectangle [u0, v0, u1, v1] of a tile, with a half-pixel inset. */
export function tileUV(index: number): [number, number, number, number] {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const inset = 0.5;
  return [
    (col * TILE + inset) / ATLAS_W,
    (row * TILE + inset) / ATLAS_H,
    ((col + 1) * TILE - inset) / ATLAS_W,
    ((row + 1) * TILE - inset) / ATLAS_H,
  ];
}
