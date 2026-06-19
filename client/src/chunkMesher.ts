// Converts a chunk's voxels into Three.js geometry with per-face culling, atlas
// UVs, and per-vertex ambient occlusion (darkening concave corners for depth).
// Three passes: opaque (lit + AO), glow (self-lit), and translucent water (whose
// top surface is dropped slightly, Minecraft-style).

import * as THREE from "three";
import { BlockType, BLOCKS, isOpaque } from "../../shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../../shared/constants";
import { BLOCK_TILES, glowMaterial, opaqueMaterial, tileUV, waterMaterial } from "./textures";
import { ClientWorld } from "./world";

interface Face {
  dir: [number, number, number];
  corners: [number, number, number][];
  kind: "top" | "bottom" | "side";
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

// Brightness for ambient-occlusion levels 0 (most occluded) .. 3 (open).
const AO_LIGHT = [0.5, 0.7, 0.86, 1.0];
const WATER_DROP = 0.12; // how far the water top surface sits below the block top

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

function emptyBuffers(): Buffers {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function tileForFace(block: BlockType, kind: Face["kind"]): number {
  const tiles = BLOCK_TILES[block];
  if (!tiles) return 0;
  return kind === "top" ? tiles.top : kind === "bottom" ? tiles.bottom : tiles.side;
}

/** Ambient occlusion (0..3) at one face corner from its three neighbour blocks. */
function cornerAO(world: ClientWorld, x: number, y: number, z: number, dir: number[], corner: number[]): number {
  const na = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
  const t = [0, 1, 2].filter((a) => a !== na);
  const s1 = corner[t[0]] * 2 - 1;
  const s2 = corner[t[1]] * 2 - 1;
  const sample = (a: number, b: number): number => {
    const p = [x + dir[0], y + dir[1], z + dir[2]];
    p[t[0]] += a;
    p[t[1]] += b;
    return isOpaque(world.getBlock(p[0], p[1], p[2])) ? 1 : 0;
  };
  const side1 = sample(s1, 0);
  const side2 = sample(0, s2);
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + sample(s1, s2));
}

function pushFace(
  buf: Buffers,
  wx: number,
  y: number,
  wz: number,
  face: Face,
  tile: number,
  world: ClientWorld | null,
  yOffset: number,
): void {
  const start = buf.positions.length / 3;
  const [u0, v0, u1, v1] = tileUV(tile);
  const ao: number[] = [];
  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    buf.positions.push(wx + c[0], y + c[1] + yOffset, wz + c[2]);
    buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    const uv = face.uv[i];
    buf.uvs.push(u0 + uv[0] * (u1 - u0), v0 + uv[1] * (v1 - v0));
    const level = world ? cornerAO(world, wx, y, wz, face.dir, c) : 3;
    ao.push(level);
    const light = AO_LIGHT[level];
    buf.colors.push(light, light, light);
  }
  // Split the quad along the darker diagonal to avoid AO interpolation seams.
  if (ao[0] + ao[2] > ao[1] + ao[3]) {
    buf.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else {
    buf.indices.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
  }
}

function geometryFrom(buf: Buffers, withColor: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(buf.normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uvs, 2));
  if (withColor) g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
  g.setIndex(buf.indices);
  return g;
}

export interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
}

function hides(self: BlockType, neighbour: BlockType): boolean {
  if (isOpaque(neighbour)) return true;
  if (self === neighbour) return true;
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
        const isWater = block === BlockType.Water;
        const buf = def.glow ? glow : def.transparent ? transparent : opaque;
        // Opaque blocks get ambient occlusion; glow/water stay flat.
        const aoWorld = buf === opaque ? world : null;
        for (const face of FACES) {
          const nb = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
          if (hides(block, nb)) continue;
          const yOffset = isWater && face.kind === "top" ? -WATER_DROP : 0;
          pushFace(buf, wx, y, wz, face, tileForFace(block, face.kind), aoWorld, yOffset);
        }
      }
    }
  }

  return {
    opaque: opaque.positions.length ? new THREE.Mesh(geometryFrom(opaque, true), opaqueMaterial) : null,
    glow: glow.positions.length ? new THREE.Mesh(geometryFrom(glow, false), glowMaterial) : null,
    transparent: transparent.positions.length ? new THREE.Mesh(geometryFrom(transparent, false), waterMaterial) : null,
  };
}
