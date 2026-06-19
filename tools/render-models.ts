// Offline isometric preview of the procedural creature/NPC models, so the
// silhouettes can be checked without a browser. Dev-only (needs node-canvas):
//   npm i canvas && npx tsx tools/render-models.ts
// This approximates the Three.js models (boxes as iso cubes, cones as triangles;
// mesh rotations are ignored) — good enough to read the shapes.

import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { buildMonsterModel, buildNpcModel } from "../client/src/models";

const SCALE = 46;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

interface Prim {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  cone: boolean;
  color: string;
  depth: number;
}

function collect(group: THREE.Object3D): Prim[] {
  const prims: Prim[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as THREE.Mesh).isMesh) return;
    const g = m.geometry as THREE.BufferGeometry & { parameters?: Record<string, number>; type: string };
    const p = g.parameters ?? {};
    const color = "#" + ((m.material as THREE.MeshLambertMaterial).color?.getHexString() ?? "888888");
    const pos = m.position;
    if (g.type === "ConeGeometry") {
      prims.push({ x: pos.x, y: pos.y, z: pos.z, w: (p.radius ?? 0.1) * 2, h: p.height ?? 0.2, d: (p.radius ?? 0.1) * 2, cone: true, color, depth: pos.x + pos.z + pos.y * 0.4 });
    } else {
      prims.push({ x: pos.x, y: pos.y, z: pos.z, w: p.width ?? 0.2, h: p.height ?? 0.2, d: p.depth ?? 0.2, cone: false, color, depth: pos.x + pos.z + pos.y * 0.4 });
    }
  });
  return prims.sort((a, b) => a.depth - b.depth);
}

function proj(x: number, y: number, z: number, ox: number, oy: number): [number, number] {
  return [ox + (x - z) * COS * SCALE, oy - y * SCALE + (x + z) * SIN * SCALE];
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return "#" + c.getHexString();
}

function drawBox(ctx: any, pr: Prim, ox: number, oy: number): void {
  const { x, y, z, w, h, d } = pr;
  const x0 = x - w / 2, x1 = x + w / 2;
  const y0 = y - h / 2, y1 = y + h / 2;
  const z0 = z - d / 2, z1 = z + d / 2;
  const P = (px: number, py: number, pz: number) => proj(px, py, pz, ox, oy);
  // top
  poly(ctx, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], shade(pr.color, 1.0));
  // left (-x face toward viewer-left)
  poly(ctx, [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], shade(pr.color, 0.65));
  // right (+z face)
  poly(ctx, [P(x0, y0, z1), P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)], shade(pr.color, 0.8));
}

function drawCone(ctx: any, pr: Prim, ox: number, oy: number): void {
  const apex = proj(pr.x, pr.y + pr.h / 2, pr.z, ox, oy);
  const bl = proj(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.z, ox, oy);
  const br = proj(pr.x + pr.w / 2, pr.y - pr.h / 2, pr.z, ox, oy);
  poly(ctx, [apex, bl, br], shade(pr.color, 0.9));
}

function poly(ctx: any, pts: [number, number][], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

const MONSTER_COLORS: Record<string, string> = { goblin: "#5a7d3a", wolf: "#9aa0a8", scorpion: "#b5803a", skeleton: "#dcd8c8" };
const NPC_COLORS: Record<string, string> = { banker: "#3a6ea5", shop: "#a5673a", quest: "#7a3a8a" };

const cells: { label: string; group: THREE.Group }[] = [
  { label: "Goblin", group: buildMonsterModel("goblin", MONSTER_COLORS.goblin) },
  { label: "Grey Wolf", group: buildMonsterModel("wolf", MONSTER_COLORS.wolf) },
  { label: "Scorpion", group: buildMonsterModel("scorpion", MONSTER_COLORS.scorpion) },
  { label: "Skeleton", group: buildMonsterModel("skeleton", MONSTER_COLORS.skeleton) },
  { label: "Banker", group: buildNpcModel("banker", NPC_COLORS.banker) },
  { label: "Shopkeeper", group: buildNpcModel("shop", NPC_COLORS.shop) },
  { label: "Quest Giver", group: buildNpcModel("quest", NPC_COLORS.quest) },
];

const CW = 200, CH = 220, COLS = 4;
const rows = Math.ceil(cells.length / COLS);
const canvas = createCanvas(CW * COLS, CH * rows);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#1a1f2b";
ctx.fillRect(0, 0, canvas.width, canvas.height);

cells.forEach((cell, i) => {
  const gx = (i % COLS) * CW;
  const gy = Math.floor(i / COLS) * CH;
  const ox = gx + CW / 2;
  const oy = gy + CH - 50;
  for (const pr of collect(cell.group)) (pr.cone ? drawCone : drawBox)(ctx, pr, ox, oy);
  ctx.fillStyle = "#dfe6f0";
  ctx.font = "15px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(cell.label, ox, gy + CH - 12);
});

const out = process.env.OUT ?? "models.png";
writeFileSync(out, canvas.toBuffer("image/png"));
console.log(`wrote ${out} (${canvas.width}x${canvas.height})`);
