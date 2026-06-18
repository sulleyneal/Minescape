// Owns the Three.js scene, camera, chunk mesh cache, remote-player avatars, and
// the block-selection highlight. Knows nothing about networking or input.

import * as THREE from "three";
import { ClientWorld } from "./world";
import { buildChunkMeshes, ChunkMeshes } from "./chunkMesher";

// A soft twilight palette for a more mystical mood than plain daylight.
const SKY = 0x9fb0e0;

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private chunkMeshes = new Map<string, ChunkMeshes>();
  private playerMeshes = new Map<string, THREE.Group>();
  private highlight: THREE.LineSegments;

  constructor(canvas: HTMLCanvasElement, private world: ClientWorld) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 48, 150);

    // Lighting: sky/ground hemisphere + a warm sun + gentle violet ambient.
    // Tuned so shaded sides/undersides stay readable rather than murky.
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x6a6070, 0.85));
    this.scene.add(new THREE.AmbientLight(0xa99fce, 0.5));
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.7);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Block selection wireframe.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Rebuild any chunk meshes flagged dirty by the world. */
  syncChunks(): void {
    if (this.world.dirty.size === 0) return;
    for (const k of this.world.dirty) {
      const [cx, cz] = k.split(",").map(Number);
      this.disposeChunk(k);
      const meshes = buildChunkMeshes(this.world, cx, cz);
      if (meshes.opaque) this.scene.add(meshes.opaque);
      if (meshes.glow) this.scene.add(meshes.glow);
      if (meshes.transparent) this.scene.add(meshes.transparent);
      this.chunkMeshes.set(k, meshes);
    }
    this.world.dirty.clear();
  }

  private disposeChunk(key: string): void {
    const existing = this.chunkMeshes.get(key);
    if (!existing) return;
    for (const m of [existing.opaque, existing.glow, existing.transparent]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.delete(key);
  }

  setHighlight(block: { x: number; y: number; z: number } | null): void {
    if (!block) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
  }

  // ---- Remote players ----

  upsertPlayer(id: string, name: string, pos: { x: number; y: number; z: number }, yaw: number): void {
    let group = this.playerMeshes.get(id);
    if (!group) {
      group = this.makeAvatar(name);
      this.playerMeshes.set(id, group);
      this.scene.add(group);
    }
    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.y = yaw;
  }

  removePlayer(id: string): void {
    const group = this.playerMeshes.get(id);
    if (!group) return;
    this.scene.remove(group);
    this.playerMeshes.delete(id);
  }

  private makeAvatar(name: string): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.8, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xcc4444 }),
    );
    body.position.y = 0.9;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xe0b48a }),
    );
    head.position.y = 2.05;
    group.add(head);
    group.add(this.makeNameTag(name));
    return group;
  }

  private makeNameTag(name: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#ffe066";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.position.y = 2.6;
    sprite.scale.set(2, 0.5, 1);
    return sprite;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
