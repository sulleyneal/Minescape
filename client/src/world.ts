// Client-side mirror of the world. Stores chunks received from the server and
// answers block queries used by meshing, collision, and raycasting.

import { BlockType } from "../../shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../../shared/constants";

const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

function key(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function localIdx(lx: number, y: number, lz: number): number {
  return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class ClientWorld {
  private chunks = new Map<string, Uint8Array>();
  /** Chunk keys whose meshes need rebuilding. */
  dirty = new Set<string>();

  setChunk(cx: number, cz: number, b64: string): void {
    this.chunks.set(key(cx, cz), decodeBase64(b64));
    this.markDirty(cx, cz);
    // Neighbours must re-mesh so the seam faces resolve correctly.
    this.markDirty(cx - 1, cz);
    this.markDirty(cx + 1, cz);
    this.markDirty(cx, cz - 1);
    this.markDirty(cx, cz + 1);
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(key(cx, cz));
  }

  private markDirty(cx: number, cz: number): void {
    if (this.chunks.has(key(cx, cz))) this.dirty.add(key(cx, cz));
  }

  getChunk(cx: number, cz: number): Uint8Array | undefined {
    return this.chunks.get(key(cx, cz));
  }

  getBlock(x: number, y: number, z: number): BlockType {
    if (y < 0 || y >= WORLD_HEIGHT) return BlockType.Air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return BlockType.Air;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk[localIdx(lx, y, lz)] as BlockType;
  }

  setBlock(x: number, y: number, z: number, block: BlockType): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk[localIdx(lx, y, lz)] = block;
    this.markDirty(cx, cz);
    // Edits on a chunk border affect the neighbour's seam faces too.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  allChunkKeys(): string[] {
    return [...this.chunks.keys()];
  }
}
