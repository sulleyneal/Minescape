// The origin town. Procedurally stamped into world generation (not stored as
// edits) so it's deterministic, free, and identical for every player.
//
// It does three jobs: give the NPCs proper houses (gabled roofs, corner posts,
// windows, doorways), raise a battlemented stone keep with a glowing finial as
// a landmark you can navigate by, and pave roads that radiate outward so however
// far you roam you can find a path and follow it home.

import { BlockType } from "../shared/blocks";
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../shared/constants";

const PLAZA_FLAT = 18; // fully flattened plaza radius
const PLAZA_BLEND = 32; // terrain eases back to natural height by here
const ROAD_LEN = 80; // how far the roads reach into the wild
const ROAD_HALF = 1; // road half-width → 3 blocks wide

// Eight spokes (cardinals + diagonals) so almost any heading crosses a road.
const ROAD_DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// ---- Town layout ----------------------------------------------------------

interface House {
  x0: number; z0: number; x1: number; z1: number; // wall footprint (inclusive)
  wallH: number;
  wall: BlockType; // main wall block
  trim: BlockType; // corner posts, eave band, lintels
  roof: BlockType; // pitched roof
  door: [number, number]; // perimeter cell, opened (faces the plaza)
  ridge: "x" | "z"; // axis the roof ridge runs along
}

interface Tower {
  x: number; z: number; // centre column
  half: number; // 1 → 3×3 footprint
  height: number; // wall height above the surface
  wall: BlockType;
}

interface Prop { x: number; z: number; }

// NPC spawn positions (shared/entities NPCS) sit inside these: quest 0,-6;
// banker 5,4; shop -5,4. Doors face the central plaza.
const HOUSES: House[] = [
  // Quest hall — Captain Rovan. The keep tower rises from inside it.
  { x0: -4, z0: -12, x1: 4, z1: -4, wallH: 5, wall: BlockType.Stone, trim: BlockType.Log, roof: BlockType.Log, door: [0, -4], ridge: "z" },
  // Bank — Gilda.
  { x0: 3, z0: 2, x1: 9, z1: 7, wallH: 4, wall: BlockType.Stone, trim: BlockType.Log, roof: BlockType.Log, door: [4, 2], ridge: "x" },
  // General store — Bram (timber-framed).
  { x0: -9, z0: 2, x1: -3, z1: 7, wallH: 4, wall: BlockType.Plank, trim: BlockType.Log, roof: BlockType.Log, door: [-4, 2], ridge: "x" },
];

const TOWERS: Tower[] = [
  { x: 0, z: -9, half: 1, height: 16, wall: BlockType.Stone },
];

// Lampposts ring the plaza in the open grass between the roads (kept off the
// roads and out of the buildings so they never block a path or a doorway).
const LAMPS: Prop[] = [
  { x: 10, z: 4 }, { x: 4, z: 10 }, { x: -10, z: 4 }, { x: -4, z: 10 },
  { x: 10, z: -4 }, { x: 7, z: -3 }, { x: -10, z: -4 }, { x: -7, z: -3 },
  { x: 3, z: 14 }, { x: -3, z: 14 }, // flank the southern approach
];

// Decorative trees soften the square corners.
const TREES: Prop[] = [
  { x: 11, z: 9 }, { x: -11, z: 9 }, { x: 11, z: -9 }, { x: -11, z: -9 },
];

// ---- Terrain ---------------------------------------------------------------

/** Clamp the plaza to a sensible, above-water flat height that still leaves
 *  vertical room for the keep tower under the world ceiling. */
export function villageFlatHeight(naturalHeight: number): number {
  return Math.max(SEA_LEVEL + 2, Math.min(WORLD_HEIGHT - 26, naturalHeight));
}

/** Blend the flat plaza into natural terrain with a smoothstep so the edges
 *  roll off gently instead of forming hard terraces. */
export function villageHeightAt(wx: number, wz: number, raw: number, flat: number): number {
  const d = Math.hypot(wx, wz);
  if (d >= PLAZA_BLEND) return raw;
  if (d <= PLAZA_FLAT) return flat;
  const t = (d - PLAZA_FLAT) / (PLAZA_BLEND - PLAZA_FLAT);
  const s = t * t * (3 - 2 * t); // smoothstep
  return Math.round(flat * (1 - s) + raw * s);
}

// ---- Surfaces & masks ------------------------------------------------------

function inRect(h: House, wx: number, wz: number): boolean {
  return wx >= h.x0 && wx <= h.x1 && wz >= h.z0 && wz <= h.z1;
}

/** True for any column under a house footprint (gets a plank floor). */
export function inBuilding(wx: number, wz: number): boolean {
  return HOUSES.some((h) => inRect(h, wx, wz));
}

/** True if a road paves this column's surface. */
export function onRoad(wx: number, wz: number): boolean {
  for (const [dx, dz] of ROAD_DIRS) {
    const len = Math.hypot(dx, dz);
    const proj = (wx * dx + wz * dz) / len; // distance along the spoke
    if (proj < 0 || proj > ROAD_LEN) continue;
    const perp = Math.abs(wx * dz - wz * dx) / len; // distance from the spoke
    if (perp <= ROAD_HALF) return true;
  }
  return false;
}

/** Keep trees out of the plaza, the roads, and the buildings. */
export function villageNoTree(wx: number, wz: number): boolean {
  return Math.hypot(wx, wz) <= PLAZA_BLEND || onRoad(wx, wz) || inBuilding(wx, wz);
}

/** Surface block override (floor/path/plaza), or null to leave natural. So the
 *  town always reads as a tidy green meadow, grass is laid over the whole
 *  footprint — through the blend ring — whatever biome it landed in. */
export function villageSurface(wx: number, wz: number): BlockType | null {
  if (inBuilding(wx, wz)) return BlockType.Plank; // building floor
  if (onRoad(wx, wz)) return BlockType.Dirt; // packed-earth path
  if (Math.hypot(wx, wz) <= PLAZA_BLEND) return BlockType.Grass;
  return null;
}

// ---- Structures ------------------------------------------------------------

type Placed = { y: number; block: BlockType };

function houseColumn(h: House, wx: number, wz: number, sY: number, out: Placed[]): void {
  // Allow a one-block ring outside the footprint for the roof overhang.
  if (wx < h.x0 - 1 || wx > h.x1 + 1 || wz < h.z0 - 1 || wz > h.z1 + 1) return;

  const eaveY = sY + h.wallH;
  // Roof rises from the eaves to the ridge along the cross axis.
  const span = h.ridge === "z" ? h.x1 - h.x0 : h.z1 - h.z0;
  const pos = h.ridge === "z" ? wx - h.x0 : wz - h.z0;
  const halfSpan = Math.floor(span / 2);
  const rise = Math.max(0, halfSpan - Math.abs(pos - halfSpan));
  const roofY = eaveY + 1 + rise;

  if (!inRect(h, wx, wz)) {
    // Overhang ring: a lip of roof one block out along the eave sides.
    const eaveSide = h.ridge === "z" ? wx === h.x0 - 1 || wx === h.x1 + 1 : wz === h.z0 - 1 || wz === h.z1 + 1;
    const along = h.ridge === "z" ? wz >= h.z0 && wz <= h.z1 : wx >= h.x0 && wx <= h.x1;
    if (eaveSide && along) out.push({ y: eaveY + 1, block: h.roof });
    return;
  }

  const isCorner = (wx === h.x0 || wx === h.x1) && (wz === h.z0 || wz === h.z1);
  const isPerim = wx === h.x0 || wx === h.x1 || wz === h.z0 || wz === h.z1;
  const isGableRow = h.ridge === "z" ? wz === h.z0 || wz === h.z1 : wx === h.x0 || wx === h.x1;
  const isDoor = wx === h.door[0] && wz === h.door[1];

  if (isPerim) {
    for (let y = sY + 1; y <= eaveY; y++) {
      if (isDoor && (y === sY + 1 || y === sY + 2)) continue; // 2-tall doorway
      const eaveBand = y === eaveY;
      let block = isCorner || eaveBand ? h.trim : h.wall;
      if (isDoor && y === sY + 3) block = h.trim; // door lintel
      // Punch a window on plain wall cells at mid height.
      if (!isCorner && !isDoor && y === sY + 2 && (wx + wz) % 2 === 0) continue;
      out.push({ y, block });
    }
  }

  // Close the gable triangle so there's no gap under the slope at the ends.
  if (isGableRow) {
    for (let y = eaveY + 1; y < roofY; y++) out.push({ y, block: h.wall });
  }

  // Pitched roof layer over the whole footprint.
  out.push({ y: roofY, block: h.roof });
}

function towerColumn(t: Tower, wx: number, wz: number, sY: number, out: Placed[]): void {
  const dx = wx - t.x;
  const dz = wz - t.z;
  if (Math.abs(dx) > t.half || Math.abs(dz) > t.half) return;

  const top = sY + t.height;
  const onEdge = Math.abs(dx) === t.half || Math.abs(dz) === t.half;
  const corner = Math.abs(dx) === t.half && Math.abs(dz) === t.half;

  if (onEdge) {
    for (let y = sY + 1; y <= top; y++) {
      // Arrow-slit windows on the faces (not corners).
      if (!corner && (y === top - 4 || y === top - 8)) continue;
      out.push({ y, block: t.wall });
    }
    // Crenellations: corners plus every other face block raised one course.
    if (corner || (wx + wz) % 2 === 0) out.push({ y: top + 1, block: t.wall });
  }

  // Glowing crystal finial up the centre — the landmark beacon.
  if (dx === 0 && dz === 0) {
    for (let y = top + 1; y <= top + 5; y++) out.push({ y, block: BlockType.Crystal });
  }
}

function lampColumn(p: Prop, wx: number, wz: number, sY: number, out: Placed[]): void {
  if (wx !== p.x || wz !== p.z) return;
  out.push({ y: sY + 1, block: BlockType.Log });
  out.push({ y: sY + 2, block: BlockType.Log });
  out.push({ y: sY + 3, block: BlockType.Log });
  out.push({ y: sY + 4, block: BlockType.Crystal }); // glowing lamp
}

function treeColumn(p: Prop, wx: number, wz: number, sY: number, out: Placed[]): void {
  const dx = wx - p.x;
  const dz = wz - p.z;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return;
  if (dx === 0 && dz === 0) {
    for (let y = sY + 1; y <= sY + 3; y++) out.push({ y, block: BlockType.Log });
    out.push({ y: sY + 5, block: BlockType.Leaves }); // crown
  }
  out.push({ y: sY + 4, block: BlockType.Leaves }); // 3×3 canopy
}

/** All blocks to place above the surface at this column. */
export function villageStructure(wx: number, wz: number, sY: number): Placed[] {
  const out: Placed[] = [];
  for (const h of HOUSES) houseColumn(h, wx, wz, sY, out);
  for (const t of TOWERS) towerColumn(t, wx, wz, sY, out);
  for (const l of LAMPS) lampColumn(l, wx, wz, sY, out);
  for (const tr of TREES) treeColumn(tr, wx, wz, sY, out);
  return out;
}

/** Cheap reject so far-flung chunks skip all village work. */
export function villageAffectsChunk(baseX: number, baseZ: number): boolean {
  const nx = Math.max(baseX, Math.min(baseX + CHUNK_SIZE - 1, 0));
  const nz = Math.max(baseZ, Math.min(baseZ + CHUNK_SIZE - 1, 0));
  return Math.hypot(nx, nz) <= ROAD_LEN + 2;
}
