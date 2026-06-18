// Converts a chunk's voxels into Three.js geometry using per-face culling:
// a face is emitted only when its neighbour doesn't hide it. Face brightness is
// baked into vertex colors so the renderer needs no lights (cheap and stable).

import * as THREE from "three";
import { BlockType, BLOCKS, isOpaque } from "../../shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../../shared/constants";
import { ClientWorld } from "./world";

// Per-face shading factors give cheap directional definition.
const FACE_SHADE = {
  top: 1.0,
  bottom: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.65,
  west: 0.65,
};

interface Face {
  // corner offsets for the quad, plus the neighbour direction to test
  dir: [number, number, number];
  corners: [number, number, number][];
  shade: number;
}

const FACES: Face[] = [
  { dir: [0, 1, 0], shade: FACE_SHADE.top, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], shade: FACE_SHADE.bottom, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: FACE_SHADE.north, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], shade: FACE_SHADE.south, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { dir: [1, 0, 0], shade: FACE_SHADE.east, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], shade: FACE_SHADE.west, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
];

interface Buffers {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function emptyBuffers(): Buffers {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function pushFace(buf: Buffers, wx: number, y: number, wz: number, face: Face, color: [number, number, number]): void {
  const start = buf.positions.length / 3;
  for (const c of face.corners) {
    buf.positions.push(wx + c[0], y + c[1], wz + c[2]);
    buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    buf.colors.push(color[0] * face.shade, color[1] * face.shade, color[2] * face.shade);
  }
  buf.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function geometryFrom(buf: Buffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(buf.normals, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
  g.setIndex(buf.indices);
  return g;
}

export interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
}

const opaqueMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const transparentMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.75,
  depthWrite: false,
});

// Whether `neighbour` hides a face of `self`. Opaque neighbours always hide;
// matching transparent blocks (water/water) hide to avoid interior faces.
function hides(self: BlockType, neighbour: BlockType): boolean {
  if (isOpaque(neighbour)) return true;
  if (self === neighbour) return true;
  return false;
}

export function buildChunkMeshes(world: ClientWorld, cx: number, cz: number): ChunkMeshes {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return { opaque: null, transparent: null };

  const opaque = emptyBuffers();
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
        const isTransparent = def.transparent;
        const buf = isTransparent ? transparent : opaque;
        for (const face of FACES) {
          const nb = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
          if (hides(block, nb)) continue;
          pushFace(buf, wx, y, wz, face, def.color);
        }
      }
    }
  }

  return {
    opaque: opaque.positions.length ? new THREE.Mesh(geometryFrom(opaque), opaqueMaterial) : null,
    transparent: transparent.positions.length ? new THREE.Mesh(geometryFrom(transparent), transparentMaterial) : null,
  };
}
