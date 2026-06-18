// Authoritative world: procedural generation, chunk storage, block edits, and
// resource-node depletion/respawn. The server owns all of this; clients only
// receive chunk snapshots and individual edits.

import { BlockType } from "../shared/blocks";
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../shared/constants";
import { GATHER_NODES } from "../shared/gathering";
import { fbm } from "./noise";

const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

// Index within a chunk's flat array. Layout: y-major then z then x.
function idx(lx: number, y: number, lz: number): number {
  return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

interface DepletedNode {
  x: number;
  y: number;
  z: number;
  original: BlockType;
  respawnAtTick: number;
}

export class World {
  readonly seed: number;
  private chunks = new Map<string, Uint8Array>();
  private depleted: DepletedNode[] = [];

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  getChunk(cx: number, cz: number): Uint8Array {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generateChunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;

        // Blend two noise scales for rolling hills with occasional peaks.
        const continent = fbm(this.seed, wx / 90, wz / 90, 4);
        const detail = fbm(this.seed + 7, wx / 24, wz / 24, 3);
        const h = Math.floor(SEA_LEVEL - 4 + continent * 26 + detail * 6);
        const height = Math.max(1, Math.min(WORLD_HEIGHT - 1, h));

        for (let y = 0; y <= height; y++) {
          let block: BlockType;
          if (y === 0) {
            block = BlockType.Bedrock;
          } else if (y === height) {
            block = height < SEA_LEVEL + 1 ? BlockType.Sand : BlockType.Grass;
          } else if (y > height - 4) {
            block = BlockType.Dirt;
          } else {
            block = this.oreAt(wx, y, wz);
          }
          data[idx(lx, y, lz)] = block;
        }

        // Fill oceans/lakes with water up to sea level.
        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = BlockType.Water;
        }

        // Scatter trees on grass above the waterline.
        if (data[idx(lx, height, lz)] === BlockType.Grass && height > SEA_LEVEL) {
          const r = fbm(this.seed + 99, wx * 1.7, wz * 1.7, 2);
          if (r > 0.82 && lx > 1 && lx < CHUNK_SIZE - 2 && lz > 1 && lz < CHUNK_SIZE - 2) {
            this.placeTree(data, lx, height + 1, lz);
          }
        }
      }
    }
    return data;
  }

  private oreAt(wx: number, y: number, wz: number): BlockType {
    // Deeper rock biases toward more valuable ore and rarer mystical blocks.
    const n = fbm(this.seed + 31, wx / 8, (wz + y * 5) / 8, 3);
    const deep = y < SEA_LEVEL - 8;
    // Mystical veins use a separate noise field so they cluster on their own.
    const m = fbm(this.seed + 131, wx / 6, (wz + y * 3) / 6, 3);
    if (deep && m > 0.9) return BlockType.Crystal; // glowing aether crystals, deep only
    if (deep && m > 0.86) return BlockType.Runestone; // ancient runed stone
    if (n > 0.86) return deep ? BlockType.GoldOre : BlockType.IronOre;
    if (n > 0.78) return BlockType.CoalOre;
    if (n > 0.74) return BlockType.IronOre;
    if (m > 0.7 && m < 0.78) return BlockType.MossStone; // mossy stone pockets
    return BlockType.Stone;
  }

  private placeTree(data: Uint8Array, lx: number, baseY: number, lz: number): void {
    const trunk = 4;
    for (let i = 0; i < trunk; i++) {
      const y = baseY + i;
      if (y < WORLD_HEIGHT) data[idx(lx, y, lz)] = BlockType.Log;
    }
    const topY = baseY + trunk;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -2; dy <= 1; dy++) {
          const x = lx + dx;
          const z = lz + dz;
          const y = topY + dy;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; // round the corners
          if (data[idx(x, y, z)] === BlockType.Air) data[idx(x, y, z)] = BlockType.Leaves;
        }
      }
    }
  }

  getBlock(x: number, y: number, z: number): BlockType {
    if (y < 0 || y >= WORLD_HEIGHT) return BlockType.Air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return this.getChunk(cx, cz)[idx(lx, y, lz)] as BlockType;
  }

  setBlock(x: number, y: number, z: number, block: BlockType): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    this.getChunk(cx, cz)[idx(lx, y, lz)] = block;
  }

  /** Deplete a resource node and schedule its respawn. */
  depleteNode(x: number, y: number, z: number, depletedBlock: BlockType, respawnTicks: number, tick: number): void {
    const original = this.getBlock(x, y, z);
    this.setBlock(x, y, z, depletedBlock);
    if (respawnTicks > 0) {
      this.depleted.push({ x, y, z, original, respawnAtTick: tick + respawnTicks });
    }
  }

  /** Returns the list of blocks that respawned this tick (so the server can broadcast them). */
  tickRespawns(tick: number): { x: number; y: number; z: number; block: BlockType }[] {
    if (this.depleted.length === 0) return [];
    const ready = this.depleted.filter((d) => d.respawnAtTick <= tick);
    if (ready.length === 0) return [];
    this.depleted = this.depleted.filter((d) => d.respawnAtTick > tick);
    for (const d of ready) this.setBlock(d.x, d.y, d.z, d.original);
    return ready.map((d) => ({ x: d.x, y: d.y, z: d.z, block: d.original }));
  }

  static isGatherable(block: BlockType): boolean {
    return GATHER_NODES.some((n) => n.block === block);
  }
}
