// Owns the Three.js scene, camera, chunk mesh cache, remote-player avatars, and
// the block-selection highlight. Knows nothing about networking or input.

import * as THREE from "three";
import { EntitySnapshot } from "../../shared/protocol";
import { ClientWorld } from "./world";
import { buildChunkMeshes, ChunkMeshes } from "./chunkMesher";

interface EntityVisual {
  group: THREE.Group;
  body: THREE.Mesh;
  plate: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastHp: number;
}

// A soft twilight palette for a more mystical mood than plain daylight.
const SKY = 0x9fb0e0;

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private chunkMeshes = new Map<string, ChunkMeshes>();
  private playerMeshes = new Map<string, THREE.Group>();
  private entityVisuals = new Map<string, EntityVisual>();
  private highlight: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  private splats: { sprite: THREE.Sprite; born: number }[] = [];

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

  upsertPlayer(
    id: string,
    name: string,
    pos: { x: number; y: number; z: number },
    yaw: number,
    skin?: { body: string; head: string },
  ): void {
    let group = this.playerMeshes.get(id);
    if (!group) {
      group = this.makeAvatar(name, skin ?? { body: "#cc4444", head: "#e0b48a" });
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

  private makeAvatar(name: string, skin: { body: string; head: string }): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.3, 0.4),
      new THREE.MeshLambertMaterial({ color: skin.body }),
    );
    body.position.y = 1.05;
    group.add(body);
    // Simple arms and legs in the body color, for a less blocky silhouette.
    for (const dx of [-0.4, 0.4]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), new THREE.MeshLambertMaterial({ color: skin.body }));
      arm.position.set(dx, 1.1, 0);
      group.add(arm);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), new THREE.MeshLambertMaterial({ color: 0x33373f }));
      leg.position.set(dx * 0.45, 0.45, 0);
      group.add(leg);
    }
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshLambertMaterial({ color: skin.head }),
    );
    head.position.y = 2.0;
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

  // ---- Entities (monsters + NPCs) ----

  syncEntities(snapshots: EntitySnapshot[]): void {
    const seen = new Set<string>();
    for (const e of snapshots) {
      seen.add(e.id);
      let vis = this.entityVisuals.get(e.id);
      if (!vis) {
        vis = this.makeEntity(e);
        this.entityVisuals.set(e.id, vis);
        this.scene.add(vis.group);
      }
      vis.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      vis.group.rotation.y = e.yaw;
      if (e.kind === "monster" && e.hp !== vis.lastHp) {
        vis.lastHp = e.hp;
        this.drawPlate(vis, e);
      }
    }
    // Remove entities no longer present.
    for (const [id, vis] of this.entityVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(vis.group);
      vis.body.geometry.dispose();
      this.entityVisuals.delete(id);
    }
  }

  private makeEntity(e: EntitySnapshot): EntityVisual {
    const group = new THREE.Group();
    const color = new THREE.Color(e.kind === "npc" ? this.npcColor(e.type) : this.monsterColor(e.type));
    const scale = e.kind === "npc" ? 1 : 0.9;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6 * scale, 1.6 * scale, 0.6 * scale),
      new THREE.MeshLambertMaterial({ color }),
    );
    body.position.y = 0.8 * scale;
    body.userData.entityId = e.id;
    body.userData.entityKind = e.kind;
    group.add(body);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 80;
    const plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }),
    );
    plate.position.y = 1.9 * scale;
    plate.scale.set(2.2, 0.7, 1);
    group.add(plate);

    const vis: EntityVisual = { group, body, plate, canvas, ctx: canvas.getContext("2d")!, lastHp: e.hp };
    this.drawPlate(vis, e);
    return vis;
  }

  private drawPlate(vis: EntityVisual, e: EntitySnapshot): void {
    const ctx = vis.ctx;
    ctx.clearRect(0, 0, 256, 80);
    ctx.fillStyle = e.kind === "npc" ? "#7fd0ff" : "#ffe066";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = e.kind === "monster" && e.level ? `${e.name} (Lv ${e.level})` : e.name;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(label, 128, 22);
    ctx.fillText(label, 128, 22);
    if (e.kind === "monster") {
      const frac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "#000";
      ctx.fillRect(48, 44, 160, 16);
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(50, 46, 156, 12);
      ctx.fillStyle = "#2ecc71";
      ctx.fillRect(50, 46, 156 * frac, 12);
    }
    (vis.plate.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  private monsterColor(type: string): string {
    return { goblin: "#5a7d3a", wolf: "#9aa0a8", scorpion: "#b5803a", skeleton: "#dcd8c8" }[type] ?? "#aa4444";
  }
  private npcColor(role: string): string {
    return { banker: "#3a6ea5", shop: "#a5673a", quest: "#7a3a8a" }[role] ?? "#888888";
  }

  /** Entity under the crosshair (screen center), or null. */
  pickEntity(maxDist = 12): { id: string; kind: string; dist: number } | null {
    this.raycaster.setFromCamera(this.center, this.camera);
    const bodies = [...this.entityVisuals.values()].map((v) => v.body);
    const hits = this.raycaster.intersectObjects(bodies, false);
    if (!hits.length || hits[0].distance > maxDist) return null;
    const o = hits[0].object;
    return { id: o.userData.entityId, kind: o.userData.entityKind, dist: hits[0].distance };
  }

  /** Float a damage number above a position. */
  spawnSplat(pos: { x: number; y: number; z: number }, dmg: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = dmg > 0 ? "#e23b2e" : "#3a78d0";
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(dmg), 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }));
    sprite.position.set(pos.x, pos.y + 2, pos.z);
    sprite.scale.set(0.8, 0.8, 1);
    this.scene.add(sprite);
    this.splats.push({ sprite, born: performance.now() });
  }

  entitySplat(id: string, dmg: number): void {
    const vis = this.entityVisuals.get(id);
    if (vis) this.spawnSplat(vis.group.position, dmg);
  }

  private updateSplats(): void {
    const now = performance.now();
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      const age = (now - s.born) / 900;
      if (age >= 1) {
        this.scene.remove(s.sprite);
        this.splats.splice(i, 1);
        continue;
      }
      s.sprite.position.y += 0.012;
      (s.sprite.material as THREE.SpriteMaterial).opacity = 1 - age;
    }
  }

  render(): void {
    this.updateSplats();
    this.renderer.render(this.scene, this.camera);
  }
}
