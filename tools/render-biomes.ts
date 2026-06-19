// Top-down biome map of the generated world, to preview biome variety on any
// device. Samples the real World generator. Dev-only (needs node-canvas):
//   npm i canvas && npx tsx tools/render-biomes.ts

import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { Biome } from "../shared/biomes";
import { SEA_LEVEL } from "../shared/constants";
import { World } from "../server/world";

const SEED = Number(process.env.SEED ?? 837022);
const SPAN = 900; // world blocks across
const STEP = 3; // blocks per pixel
const PX = Math.floor(SPAN / STEP);

const COLORS: Record<Biome, [number, number, number]> = {
  [Biome.Plains]: [122, 166, 83],
  [Biome.Forest]: [54, 110, 52],
  [Biome.Desert]: [217, 203, 140],
  [Biome.Tundra]: [233, 240, 250],
  [Biome.Mountains]: [138, 138, 144],
};
const WATER: [number, number, number] = [47, 111, 208];

const world = new World(SEED);
const canvas = createCanvas(PX, PX);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(PX, PX);

for (let py = 0; py < PX; py++) {
  for (let px = 0; px < PX; px++) {
    const wx = -SPAN / 2 + px * STEP;
    const wz = -SPAN / 2 + py * STEP;
    const h = world.heightAt(wx, wz);
    let c: [number, number, number];
    if (h <= SEA_LEVEL) {
      c = WATER;
    } else {
      c = COLORS[world.biomeAt(wx, wz)];
      // Shade by height for a little relief.
      const f = 0.82 + Math.min(0.35, (h - SEA_LEVEL) / 120);
      c = [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
    }
    const i = (py * PX + px) * 4;
    img.data[i] = c[0];
    img.data[i + 1] = c[1];
    img.data[i + 2] = c[2];
    img.data[i + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);

// Mark the town / spawn at world origin.
const o = PX / 2;
ctx.strokeStyle = "#ff2d2d";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.arc(o, o, 5, 0, Math.PI * 2);
ctx.stroke();
ctx.fillStyle = "#fff";
ctx.font = "bold 12px sans-serif";
ctx.fillText("spawn", o + 8, o + 4);

const out = process.env.OUT ?? "biome-map.png";
writeFileSync(out, canvas.toBuffer("image/png"));
console.log(`wrote ${out} (${PX}x${PX}, seed ${SEED})`);
