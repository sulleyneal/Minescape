// The origin town. Procedurally stamped into world generation (not stored as
// edits) so it's deterministic, free, and identical for every player.
//
// Two jobs: give the NPCs actual buildings to stand in — including a tall,
// glowing tower over the quest hall that reads as a landmark from far off — and
// pave rough roads that radiate outward, so however far you roam you can find a
// path and follow it back to the quest giver.

import { BlockType } from "../shared/blocks";
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../shared/constants";

const PLAZA_FLAT = 16; // fully flattened plaza radius
const PLAZA_BLEND = 24; // terrain eases back to natural height by here
const ROAD_LEN = 72; // how far the roads reach into the wild
const ROAD_HALF = 1; // road half-width → 3 blocks wide

// Eight spokes (cardinals + diagonals) so almost any heading crosses a road.
const ROAD_DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

interface Building {
  x0: number; z0: number; x1: number; z1: number; // footprint (inclusive)
  h: number; // wall height
  wall: BlockType;
  roof: BlockType;
  door: [number, number]; // a perimeter cell left open, facing the plaza
  /** Optional landmark tower rising from one interior cell. */
  tower?: { x: number; z: number; top: number };
}

// Buildings are arranged around the spawn plaza; each NPC (see shared/entities
// NPCS) stands inside its building, by the door that faces the centre.
const BUILDINGS: Building[] = [
  // Quest hall (Captain Rovan, NPC at 0,-6) with a glowing beacon tower.
  { x0: -3, z0: -11, x1: 3, z1: -4, h: 5, wall: BlockType.Stone, roof: BlockType.Plank, door: [0, -4], tower: { x: 0, z: -10, top: 20 } },
  // Bank (Gilda, NPC at 5,4).
  { x0: 3, z0: 2, x1: 8, z1: 6, h: 4, wall: BlockType.Stone, roof: BlockType.Plank, door: [3, 4] },
  // General store (Bram, NPC at -5,4).
  { x0: -8, z0: 2, x1: -3, z1: 6, h: 4, wall: BlockType.Log, roof: BlockType.Plank, door: [-3, 4] },
];

/** Clamp the plaza to a sensible, above-water flat height that still leaves
 *  vertical room for the beacon tower under the world ceiling. */
export function villageFlatHeight(naturalHeight: number): number {
  return Math.max(SEA_LEVEL + 2, Math.min(WORLD_HEIGHT - 24, naturalHeight));
}

/** Blend the flat plaza height into the natural terrain so borders aren't cliffs. */
export function villageHeightAt(wx: number, wz: number, raw: number, flat: number): number {
  const d = Math.hypot(wx, wz);
  if (d >= PLAZA_BLEND) return raw;
  if (d <= PLAZA_FLAT) return flat;
  const t = (d - PLAZA_FLAT) / (PLAZA_BLEND - PLAZA_FLAT);
  return Math.round(flat * (1 - t) + raw * t);
}

function insideRect(b: Building, wx: number, wz: number): boolean {
  return wx >= b.x0 && wx <= b.x1 && wz >= b.z0 && wz <= b.z1;
}

/** True for any column that sits under a building footprint (gets a plank floor). */
export function inBuilding(wx: number, wz: number): boolean {
  return BUILDINGS.some((b) => insideRect(b, wx, wz));
}

/** True if a road paves this column's surface. */
export function onRoad(wx: number, wz: number): boolean {
  for (const [dx, dz] of ROAD_DIRS) {
    const len = Math.hypot(dx, dz);
    const proj = (wx * dx + wz * dz) / len; // distance along the spoke
    if (proj < 0 || proj > ROAD_LEN) continue;
    const perp = Math.abs(wx * dz - wz * dx) / len; // distance from the spoke line
    if (perp <= ROAD_HALF) return true;
  }
  return false;
}

/** Keep trees out of the plaza, the roads, and the buildings. */
export function villageNoTree(wx: number, wz: number): boolean {
  return Math.hypot(wx, wz) <= PLAZA_BLEND || onRoad(wx, wz) || inBuilding(wx, wz);
}

/** Surface block override for the village (floor/path), or null to leave natural. */
export function villageSurface(wx: number, wz: number): BlockType | null {
  if (inBuilding(wx, wz)) return BlockType.Plank; // building floor
  if (onRoad(wx, wz)) return BlockType.Dirt; // packed-earth path
  if (Math.hypot(wx, wz) <= PLAZA_FLAT) return BlockType.Grass; // tidy green
  return null;
}

/** Blocks to place above the surface at this column (walls, roof, tower). */
export function villageStructure(wx: number, wz: number, surfaceY: number): { y: number; block: BlockType }[] {
  const out: { y: number; block: BlockType }[] = [];
  for (const b of BUILDINGS) {
    if (!insideRect(b, wx, wz)) continue;
    const onPerim = wx === b.x0 || wx === b.x1 || wz === b.z0 || wz === b.z1;
    const isDoor = wx === b.door[0] && wz === b.door[1];
    if (onPerim && !isDoor) {
      for (let y = surfaceY + 1; y <= surfaceY + b.h; y++) out.push({ y, block: b.wall });
    }
    // Flat roof slab over the whole footprint.
    out.push({ y: surfaceY + b.h + 1, block: b.roof });
    // Beacon tower (pushed after the roof so it punches through it).
    if (b.tower && wx === b.tower.x && wz === b.tower.z) {
      for (let y = surfaceY + 1; y <= surfaceY + b.tower.top; y++) {
        const cap = y > surfaceY + b.tower.top - 3;
        out.push({ y, block: cap ? BlockType.Crystal : BlockType.Stone });
      }
    }
  }
  return out;
}

/** Cheap reject so far-flung chunks skip all village work. */
export function villageAffectsChunk(baseX: number, baseZ: number): boolean {
  const nx = Math.max(baseX, Math.min(baseX + CHUNK_SIZE - 1, 0));
  const nz = Math.max(baseZ, Math.min(baseZ + CHUNK_SIZE - 1, 0));
  return Math.hypot(nx, nz) <= ROAD_LEN + 2;
}
