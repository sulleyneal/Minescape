// Builds the Three.js texture atlas + materials from the pure tile-drawing in
// atlasDraw.ts. Three passes share one atlas: lit opaque blocks, self-lit
// "glow" blocks (crystals/runes), and translucent water.

import * as THREE from "three";
import { ATLAS_H, ATLAS_W, drawTile, NUM_TILES } from "./atlasDraw";

export { BLOCK_TILES, tileUV, TILE_INDEX } from "./atlasDraw";

function buildAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < NUM_TILES; i++) drawTile(ctx, i);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false; // keep canvas (top-left) orientation so UV maths is simple
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const ATLAS = buildAtlas();

// Materials shared by all chunk meshes.
export const opaqueMaterial = new THREE.MeshLambertMaterial({ map: ATLAS });
export const glowMaterial = new THREE.MeshBasicMaterial({ map: ATLAS }); // self-lit
export const waterMaterial = new THREE.MeshLambertMaterial({
  map: ATLAS,
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
});
