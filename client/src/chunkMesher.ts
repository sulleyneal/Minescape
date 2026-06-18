// Converts a chunk's voxels into Three.js geometry with per-face culling and
// atlas UVs. Three passes: opaque (lit), glow (self-lit crystals/runes), and
// translucent water. Normals are emitted so the scene lights shade the faces.

import * as THREE from "three";
import { BlockType, BLOCKS, isOpaque } from "../../shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../../shared/constants";
import { BLOCK_TILES, glowMaterial, opaqueMaterial, tileUV, waterMaterial } from "./textures";
import { ClientWorld } from "./world";

interface Face {
  dir: [number, number, number];
  corners: [number, number, number][];
  /** Which face kind, for picking the tile (grass top vs side, etc). */
  kind: "top" | "bottom" | "side";
  /** UV of each corner in tile space (v: 0 = top of tile). */
  uv: [number, number][];
}

const SIDE_UV: [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

const FACES: Face[] = [
  { dir: [0, 1, 0], kind: "top", corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { dir: [0, -1, 0], kind: "bottom", corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, 1], kind: "side", corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: SIDE_UV },
  { dir: [0, 0, -1], kind: "side", corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: SIDE_UV },
  { dir: [1, 0, 0], kind: "side", corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: SIDE_UV },
  { dir: [-1, 0, 0], kind: "side", corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: SIDE_UV },
];

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function emptyBuffers(): Buffers {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function tileForFace(block: BlockType, kind: Face["kind"]): number {
  const tiles = BLOCK_TILES[block];
  if (!tiles) return 0;
  return kind === "top" ? tiles.top : kind === "bottom" ? tiles.bottom : tiles.side;
}

function pushFace(buf: Buffers, wx: number, y: number, wz: number, face: Face, tile: number): void {
  const start = buf.positions.length / 3;
  const [u0, v0, u1, v1] = tileUV(tile);
  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    buf.positions.push(wx + c[0], y + c[1], wz + c[2]);
    buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    const uv = face.uv[i];
    buf.uvs.push(u0 + uv[0] * (u1 - u0), v0 + uv[1] * (v1 - v0));
  }
  buf.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function geometryFrom(buf: Buffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(buf.normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uvs, 2));
  g.setIndex(buf.indices);
  return g;
}

export interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
}

// Whether `neighbour` hides a face of `self`.
function hides(self: BlockType, neighbour: BlockType): boolean {
  if (isOpaque(neighbour)) return true;
  if (self === neighbour) return true; // matching transparent (water/water)
  return false;
}

export function buildChunkMeshes(world: ClientWorld, cx: number, cz: number): ChunkMeshes {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return { opaque: null, glow: null, transparent: null };

  const opaque = emptyBuffers();
  const glow = emptyBuffers();
  const transparent = emptyBuffers();
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        const block = world.getBlock(wx, y, wz);
        if (block === BlockType.Air) continue;
        const def = BLOCKS[block];
        const buf = def.glow ? glow : def.transparent ? transparent : opaque;
        for (const face of FACES) {
          const nb = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
          if (hides(block, nb)) continue;
          pushFace(buf, wx, y, wz, face, tileForFace(block, face.kind));
        }
      }
    }
  }

  return {
    opaque: opaque.positions.length ? new THREE.Mesh(geometryFrom(opaque), opaqueMaterial) : null,
    glow: glow.positions.length ? new THREE.Mesh(geometryFrom(glow), glowMaterial) : null,
    transparent: transparent.positions.length ? new THREE.Mesh(geometryFrom(transparent), waterMaterial) : null,
  };
}
