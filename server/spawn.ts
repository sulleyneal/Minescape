// Spawn-point selection, factored out of the game server so it can be unit
// tested directly. Finds dry, tree-free ground with clear headroom near the
// world origin, spiralling outward until a safe column is found.

import { BlockType } from "../shared/blocks";
import { WORLD_HEIGHT } from "../shared/constants";
import { Vec3 } from "../shared/protocol";
import { townSpawnCandidates } from "./village";
import { World } from "./world";

/** Top-down scan of one column: returns a standing position on solid ground,
 *  or null if the column is underwater or topped by a tree. */
export function clearColumn(world: World, x: number, z: number): Vec3 | null {
  let sawWater = false;
  for (let y = WORLD_HEIGHT - 3; y > 0; y--) {
    const b = world.getBlock(x, y, z);
    if (b === BlockType.Air) continue;
    if (b === BlockType.Water) {
      sawWater = true;
      continue;
    }
    if (b === BlockType.Leaves || b === BlockType.Log) return null; // tree canopy
    if (sawWater) return null; // ground sits under a lake
    return { x: x + 0.5, y: y + 1, z: z + 0.5 }; // stand on top of this block
  }
  return null;
}

export function findSpawn(world: World): Vec3 {
  // Prefer the town square (clear of the centre fountain) so players arrive in
  // the plaza, facing the buildings and the landmark tower.
  for (const [x, z] of townSpawnCandidates()) {
    const spawn = clearColumn(world, x, z);
    if (spawn) return spawn;
  }

  const offsets: [number, number][] = [];
  const R = 10;
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) offsets.push([dx, dz]);
  }
  // Nearest-to-origin first.
  offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  for (const [x, z] of offsets) {
    const spawn = clearColumn(world, x, z);
    if (spawn) return spawn;
  }
  return { x: 0.5, y: WORLD_HEIGHT - 8, z: 0.5 };
}
