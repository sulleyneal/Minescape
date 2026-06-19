// Authoritative world: procedural generation, chunk storage, block edits, and
// resource-node depletion/respawn. The server owns all of this; clients only
// receive chunk snapshots and individual edits.

import { BlockType } from "../shared/blocks";
import { Biome } from "../shared/biomes";
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "../shared/constants";
import { GATHER_NODES } from "../shared/gathering";
import { fbm } from "./noise";
import { villageAffectsChunk, villageFlatHeight, villageHeightAt, villageNoTree, villageStructure, villageSurface } from "./village";

const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

const TREE_DENSITY: Partial<Record<Biome, number>> = {
  [Biome.Forest]: 0.58,
  [Biome.Plains]: 0.82,
  [Biome.Tundra]: 0.86,
};

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
  /** What the node was set to while depleted; respawn is skipped if it changed. */
  depleted: BlockType;
  respawnAtTick: number;
}

export class World {
  readonly seed: number;
  private chunks = new Map<string, Uint8Array>();
  private depleted: DepletedNode[] = [];
  /** Persistent player edits, per chunk, keyed by in-chunk index → block. */
  private editsByChunk = new Map<string, Map<number, BlockType>>();
  /** Flat height the origin town sits on (computed once from the seed). */
  private villageHeight: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.villageHeight = villageFlatHeight(this.rawHeightAt(0, 0));
  }

  getChunk(cx: number, cz: number): Uint8Array {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generateChunk(cx, cz);
      // Re-apply saved player edits on top of fresh generation.
      const edits = this.editsByChunk.get(key);
      if (edits) for (const [i, block] of edits) chunk[i] = block;
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** Natural terrain height, blended so biome borders don't form cliffs. */
  private rawHeightAt(wx: number, wz: number): number {
    const continent = fbm(this.seed, wx / 110, wz / 110, 4);
    const detail = fbm(this.seed + 7, wx / 22, wz / 22, 3);
    const mtn = fbm(this.seed + 320, wx / 150, wz / 150, 3);
    const peak = Math.max(0, mtn - 0.5) / 0.5; // 0..1, only the highlands rise
    const mountainBoost = peak * peak * 34;
    const h = SEA_LEVEL - 6 + continent * 22 + detail * 5 + mountainBoost;
    return Math.max(1, Math.min(WORLD_HEIGHT - 2, Math.floor(h)));
  }

  /** Surface height, flattened over the origin town's plaza. */
  heightAt(wx: number, wz: number): number {
    return villageHeightAt(wx, wz, this.rawHeightAt(wx, wz), this.villageHeight);
  }

  biomeAt(wx: number, wz: number): Biome {
    const mtn = fbm(this.seed + 320, wx / 150, wz / 150, 3);
    if (mtn > 0.72) return Biome.Mountains;
    const temp = fbm(this.seed + 200, wx / 200, wz / 200, 3);
    const moist = fbm(this.seed + 260, wx / 220, wz / 220, 3);
    if (temp < 0.36) return Biome.Tundra;
    if (temp > 0.66 && moist < 0.45) return Biome.Desert;
    if (moist > 0.58) return Biome.Forest;
    return Biome.Plains;
  }

  private surfaceBlock(biome: Biome, height: number): BlockType {
    if (height <= SEA_LEVEL) return BlockType.Sand; // beaches / lake floors
    switch (biome) {
      case Biome.Desert:
        return BlockType.Sand;
      case Biome.Tundra:
        return BlockType.Snow;
      case Biome.Mountains:
        if (height > SEA_LEVEL + 20) return BlockType.Snow;
        if (height > SEA_LEVEL + 8) return BlockType.Stone;
        return BlockType.Grass;
      default:
        return BlockType.Grass;
    }
  }

  private generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_VOLUME);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const village = villageAffectsChunk(baseX, baseZ);

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const biome = this.biomeAt(wx, wz);
        const height = this.heightAt(wx, wz);
        const vSurface = village ? villageSurface(wx, wz) : null;
        const surface = vSurface ?? this.surfaceBlock(biome, height);
        const subSurface = biome === Biome.Desert ? BlockType.Sand : BlockType.Dirt;

        for (let y = 0; y <= height; y++) {
          let block: BlockType;
          if (y === 0) {
            block = BlockType.Bedrock;
          } else if (y === height) {
            block = surface;
          } else if (y > height - 4) {
            block = subSurface;
          } else {
            block = this.oreAt(wx, y, wz);
          }
          data[idx(lx, y, lz)] = block;
        }

        // Fill oceans/lakes with water up to sea level.
        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = BlockType.Water;
        }

        // Scatter trees per-biome on grass/snow above the waterline — but never
        // over the town plaza, its roads, or buildings.
        const top = data[idx(lx, height, lz)];
        const density = TREE_DENSITY[biome];
        if (density && (top === BlockType.Grass || top === BlockType.Snow) && height > SEA_LEVEL && !(village && villageNoTree(wx, wz))) {
          const r = fbm(this.seed + 99, wx * 1.7, wz * 1.7, 2);
          if (r > density && lx > 1 && lx < CHUNK_SIZE - 2 && lz > 1 && lz < CHUNK_SIZE - 2) {
            this.placeTree(data, lx, height + 1, lz);
          }
        }

        // Raise the town's walls, roofs and beacon tower above the surface.
        if (village) {
          for (const s of villageStructure(wx, wz, height)) {
            if (s.y > height && s.y < WORLD_HEIGHT) data[idx(lx, s.y, lz)] = s.block;
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

  /** Transient block change (resource depletion/respawn) — not persisted. */
  setBlock(x: number, y: number, z: number, block: BlockType): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    this.getChunk(cx, cz)[idx(lx, y, lz)] = block;
  }

  /** Permanent player edit (break/place) — recorded so it can be saved/restored. */
  editBlock(x: number, y: number, z: number, block: BlockType): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const key = chunkKey(cx, cz);
    this.getChunk(cx, cz)[idx(lx, y, lz)] = block;
    let edits = this.editsByChunk.get(key);
    if (!edits) {
      edits = new Map();
      this.editsByChunk.set(key, edits);
    }
    edits.set(idx(lx, y, lz), block);
  }

  /** Load saved edits before chunks are generated (applied on generation). */
  loadEdits(list: [number, number, number, number][] | undefined): void {
    if (!list) return;
    for (const [x, y, z, block] of list) {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const key = chunkKey(cx, cz);
      let edits = this.editsByChunk.get(key);
      if (!edits) {
        edits = new Map();
        this.editsByChunk.set(key, edits);
      }
      edits.set(idx(lx, y, lz), block as BlockType);
    }
  }

  /** Flatten edits for saving: [x, y, z, block]. */
  exportEdits(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const [key, edits] of this.editsByChunk) {
      const [cx, cz] = key.split(",").map(Number);
      for (const [i, block] of edits) {
        const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
        const rem = i - y * CHUNK_SIZE * CHUNK_SIZE;
        const lz = Math.floor(rem / CHUNK_SIZE);
        const lx = rem - lz * CHUNK_SIZE;
        out.push([cx * CHUNK_SIZE + lx, y, cz * CHUNK_SIZE + lz, block]);
      }
    }
    return out;
  }

  /** Deplete a resource node and schedule its respawn. */
  depleteNode(x: number, y: number, z: number, depletedBlock: BlockType, respawnTicks: number, tick: number): void {
    const original = this.getBlock(x, y, z);
    this.setBlock(x, y, z, depletedBlock);
    if (respawnTicks > 0) {
      // Replace any stale schedule for this exact spot so a node can't queue twice.
      this.depleted = this.depleted.filter((d) => d.x !== x || d.y !== y || d.z !== z);
      this.depleted.push({ x, y, z, original, depleted: depletedBlock, respawnAtTick: tick + respawnTicks });
    }
  }

  /** Returns the list of blocks that respawned this tick (so the server can broadcast them). */
  tickRespawns(tick: number): { x: number; y: number; z: number; block: BlockType }[] {
    if (this.depleted.length === 0) return [];
    const ready = this.depleted.filter((d) => d.respawnAtTick <= tick);
    if (ready.length === 0) return [];
    this.depleted = this.depleted.filter((d) => d.respawnAtTick > tick);
    const restored: { x: number; y: number; z: number; block: BlockType }[] = [];
    for (const d of ready) {
      // Only regrow if the spot is still depleted (a player may have mined or
      // built over it in the meantime — don't clobber that).
      if (this.getBlock(d.x, d.y, d.z) !== d.depleted) continue;
      this.setBlock(d.x, d.y, d.z, d.original);
      restored.push({ x: d.x, y: d.y, z: d.z, block: d.original });
    }
    return restored;
  }

  static isGatherable(block: BlockType): boolean {
    return GATHER_NODES.some((n) => n.block === block);
  }
}
