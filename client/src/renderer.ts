// Owns the Three.js scene, camera, chunk mesh cache, avatars/creatures, the
// day/night sky, particles, and the first-person viewmodel. Knows nothing
// about networking or input.

import * as THREE from "three";
import { Gear } from "../../shared/equipment";
import { EntitySnapshot, Skin } from "../../shared/protocol";
import { ClientWorld } from "./world";
import { buildChunkMeshes, ChunkMeshes } from "./chunkMesher";
import { buildHeldModel, buildMonsterModel, buildNpcModel } from "./models";

/** Shared animation state for anything that moves and swings limbs. */
interface AnimState {
  target: THREE.Vector3;
  tYaw: number;
  phase: number;
  moveEnergy: number;
  limbs: THREE.Object3D[];
}

interface PlayerVisual extends AnimState {
  group: THREE.Group;
  name: string;
  skin: Skin;
  gear: Gear;
}

interface EntityVisual extends AnimState {
  group: THREE.Group;
  plate: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastHp: number;
}

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  life: number;
  gravity: number;
}

// Day/night palette anchors.
const SKY_HORIZON_DAY = new THREE.Color(0x9fb0e0);
const SKY_HORIZON_NIGHT = new THREE.Color(0x10142a);
const SKY_TOP_DAY = new THREE.Color(0x4f6bbd);
const SKY_TOP_NIGHT = new THREE.Color(0x070b18);
const SUN_DAY = new THREE.Color(0xfff0d0);
const SUN_NIGHT = new THREE.Color(0x6b7fc8);

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Which way a tagged limb swings in the walk cycle. */
function limbSwing(tag: string, phase: number, energy: number): number {
  switch (tag) {
    case "legL":
      return Math.sin(phase) * 0.75 * energy;
    case "legR":
      return Math.sin(phase + Math.PI) * 0.75 * energy;
    case "armL":
      return Math.sin(phase + Math.PI) * 0.45 * energy;
    case "armR":
      return Math.sin(phase) * 0.45 * energy;
    default:
      return 0;
  }
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private chunkMeshes = new Map<string, ChunkMeshes>();
  private playerMeshes = new Map<string, PlayerVisual>();
  private entityVisuals = new Map<string, EntityVisual>();
  private highlight: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  private splats: { sprite: THREE.Sprite; born: number }[] = [];
  private bursts: Burst[] = [];
  private tmpV = new THREE.Vector3();

  // Day/night sky.
  private sky!: THREE.Mesh;
  private skyHeights!: Float32Array;
  private skyColorAttr!: THREE.BufferAttribute;
  private sunSprite!: THREE.Sprite;
  private moonSprite!: THREE.Sprite;
  private stars!: THREE.Points;
  private hemi: THREE.HemisphereLight;
  private amb: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private timeTarget = 0.2;
  private timeDisplay = 0.2;

  // First-person viewmodel.
  private heldGroup = new THREE.Group();
  private heldKey = "";
  private heldActive = false;
  private swingT = 1; // 1 = at rest
  private bobPhase = 0;
  private lastCamPos = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private world: ClientWorld) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = SKY_HORIZON_DAY.clone();
    this.scene.fog = new THREE.Fog(SKY_HORIZON_DAY.clone(), 48, 150);
    this.scene.add(this.makeSky());

    // Lighting: sky/ground hemisphere + a sun + gentle ambient, all modulated
    // by the time of day. Tuned so shaded faces stay readable, never murky.
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a6070, 0.85);
    this.amb = new THREE.AmbientLight(0xa99fce, 0.5);
    this.sunLight = new THREE.DirectionalLight(0xfff0d0, 0.7);
    this.sunLight.position.set(0.5, 1, 0.3);
    this.scene.add(this.hemi, this.amb, this.sunLight);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.scene.add(this.camera); // so camera-attached children (viewmodel) render
    this.heldGroup.position.set(0.38, -0.34, -0.6);
    this.heldGroup.rotation.set(-0.2, 0.25, 0.05);
    this.camera.add(this.heldGroup);

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

  // ---- Day/night sky ----

  /** A camera-following dome with per-vertex gradient, sun, moon, and stars. */
  private makeSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(420, 24, 16);
    const pos = geo.attributes.position;
    this.skyHeights = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      this.skyHeights[i] = Math.pow(Math.max(0, Math.min(1, pos.getY(i) / 420)), 0.6);
    }
    this.skyColorAttr = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute("color", this.skyColorAttr);
    const sky = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -10;

    this.sunSprite = this.makeGlowSprite("#fff3c8", 64);
    this.moonSprite = this.makeGlowSprite("#dfe6ff", 40);
    sky.add(this.sunSprite, this.moonSprite);

    // Stars scattered on the upper dome, faded in at night.
    const starCount = 320;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45; // upper sky only
      starPos[i * 3] = Math.sin(phi) * Math.cos(theta) * 400;
      starPos[i * 3 + 1] = Math.cos(phi) * 400;
      starPos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * 400;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, transparent: true, opacity: 0, fog: false, sizeAttenuation: false, depthWrite: false }),
    );
    sky.add(this.stars);

    this.sky = sky;
    this.updateDayNight(); // paint initial colors
    return sky;
  }

  private makeGlowSprite(color: string, scale: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color + "cc");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, fog: false, depthWrite: false }),
    );
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  /** Server-synced world clock (0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight). */
  setTimeOfDay(time: number): void {
    this.timeTarget = time;
  }

  private updateDayNight(dt = 0): void {
    // Ease toward the server clock, wrapping around midnight correctly.
    let delta = ((this.timeTarget - this.timeDisplay + 1.5) % 1) - 0.5;
    this.timeDisplay = (this.timeDisplay + delta * Math.min(1, dt * 1.5) + 1) % 1;

    const angle = this.timeDisplay * Math.PI * 2; // 0 = dawn horizon
    const sunY = Math.sin(angle);
    const daylight = Math.max(0, Math.min(1, sunY * 1.3 + 0.3));

    // Sky gradient.
    const horizon = SKY_HORIZON_NIGHT.clone().lerp(SKY_HORIZON_DAY, daylight);
    const top = SKY_TOP_NIGHT.clone().lerp(SKY_TOP_DAY, daylight);
    const arr = this.skyColorAttr.array as Float32Array;
    const tmp = new THREE.Color();
    for (let i = 0; i < this.skyHeights.length; i++) {
      tmp.copy(horizon).lerp(top, this.skyHeights[i]);
      arr[i * 3] = tmp.r;
      arr[i * 3 + 1] = tmp.g;
      arr[i * 3 + 2] = tmp.b;
    }
    this.skyColorAttr.needsUpdate = true;
    (this.scene.fog as THREE.Fog).color.copy(horizon);
    (this.scene.background as THREE.Color).copy(horizon);

    // Sun and moon ride opposite ends of the same orbit.
    this.sunSprite.position.set(Math.cos(angle) * 370, sunY * 370, -60);
    this.moonSprite.position.set(-Math.cos(angle) * 370, -sunY * 370, 60);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 0.9 - daylight * 1.6);

    // Lights follow the sun (moonlight takes over at night, faint and cool).
    this.hemi.intensity = 0.28 + 0.6 * daylight;
    this.amb.intensity = 0.2 + 0.32 * daylight;
    this.sunLight.intensity = 0.12 + 0.6 * daylight;
    this.sunLight.color.copy(SUN_NIGHT).lerp(SUN_DAY, daylight);
    const dir = daylight > 0.05 ? new THREE.Vector3(Math.cos(angle), Math.max(0.15, sunY), 0.25) : new THREE.Vector3(-Math.cos(angle), Math.max(0.15, -sunY), 0.25);
    this.sunLight.position.copy(dir.normalize().multiplyScalar(100));
  }

  // ---- Chunks ----

  /** Rebuild any chunk meshes flagged dirty by the world. */
  syncChunks(): void {
    if (this.world.dirty.size === 0) return;
    for (const k of this.world.dirty) {
      const [cx, cz] = k.split(",").map(Number);
      this.disposeChunk(k);
      const meshes = buildChunkMeshes(this.world, cx, cz);
      for (const m of [meshes.opaque, meshes.glow, meshes.transparent, meshes.plants]) {
        if (m) this.scene.add(m);
      }
      this.chunkMeshes.set(k, meshes);
    }
    this.world.dirty.clear();
  }

  private disposeChunk(key: string): void {
    const existing = this.chunkMeshes.get(key);
    if (!existing) return;
    for (const m of [existing.opaque, existing.glow, existing.transparent, existing.plants]) {
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
    skin?: Skin,
    gear?: Gear,
  ): void {
    let vis = this.playerMeshes.get(id);
    if (!vis) {
      vis = {
        group: new THREE.Group(),
        name,
        skin: skin ?? { body: "#cc4444", head: "#e0b48a" },
        gear: gear ?? {},
        target: new THREE.Vector3(pos.x, pos.y, pos.z),
        tYaw: yaw,
        phase: Math.random() * Math.PI * 2,
        moveEnergy: 0,
        limbs: [],
      };
      this.rebuildAvatar(vis);
      vis.group.position.copy(vis.target); // snap on first sight
      vis.group.rotation.y = yaw;
      this.playerMeshes.set(id, vis);
      this.scene.add(vis.group);
    } else if (skin || gear) {
      if (skin) vis.skin = skin;
      if (gear) vis.gear = gear;
      this.rebuildAvatar(vis);
    }
    vis.target.set(pos.x, pos.y, pos.z);
    vis.tYaw = yaw;
  }

  setPlayerGear(id: string, gear: Gear): void {
    const vis = this.playerMeshes.get(id);
    if (!vis) return;
    vis.gear = gear;
    this.rebuildAvatar(vis);
  }

  removePlayer(id: string): void {
    const vis = this.playerMeshes.get(id);
    if (!vis) return;
    this.scene.remove(vis.group);
    this.playerMeshes.delete(id);
  }

  /** (Re)build an avatar's meshes from its current skin + worn gear. */
  private rebuildAvatar(vis: PlayerVisual): void {
    const { group, skin, gear } = vis;
    group.clear();
    group.add(this.makeBlob(0.45));
    const bodyColor = gear.body ?? skin.body;
    const legColor = gear.legs ?? "#33373f";
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.4), new THREE.MeshLambertMaterial({ color: bodyColor }));
    body.position.y = 1.05;
    group.add(body);
    for (const [dx, side] of [[-0.4, "L"], [0.4, "R"]] as const) {
      const arm = new THREE.Group();
      arm.position.set(dx, 1.68, 0);
      const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), new THREE.MeshLambertMaterial({ color: bodyColor }));
      armMesh.position.y = -0.6;
      arm.add(armMesh);
      arm.userData.limb = `arm${side}`;
      group.add(arm);

      const leg = new THREE.Group();
      leg.position.set(dx * 0.45, 0.9, 0);
      const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), new THREE.MeshLambertMaterial({ color: legColor }));
      legMesh.position.y = -0.45;
      leg.add(legMesh);
      leg.userData.limb = `leg${side}`;
      group.add(leg);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshLambertMaterial({ color: skin.head }));
    head.position.y = 2.0;
    group.add(head);
    if (gear.helmet) {
      const helm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.62), new THREE.MeshLambertMaterial({ color: gear.helmet }));
      helm.position.y = 2.28;
      group.add(helm);
    }
    group.add(this.makeNameTag(vis.name));
    vis.limbs = this.collectLimbs(group);
  }

  private collectLimbs(group: THREE.Group): THREE.Object3D[] {
    const limbs: THREE.Object3D[] = [];
    group.traverse((o) => {
      if (o.userData.limb) limbs.push(o);
    });
    return limbs;
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
      vis.target.set(e.pos.x, e.pos.y, e.pos.z);
      vis.tYaw = e.yaw;
      if (e.kind === "monster" && e.hp !== vis.lastHp) {
        vis.lastHp = e.hp;
        this.drawPlate(vis, e);
      }
    }
    // Remove entities no longer present.
    for (const [id, vis] of this.entityVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(vis.group);
      vis.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.entityVisuals.delete(id);
    }
  }

  private makeEntity(e: EntitySnapshot): EntityVisual {
    const group = new THREE.Group();
    const color = e.kind === "npc" ? this.npcColor(e.type) : this.monsterColor(e.type);
    const lowSlung = e.type === "wolf" || e.type === "scorpion";

    group.add(this.makeBlob(e.type === "golem" ? 0.85 : lowSlung ? 0.7 : 0.45));

    const model = e.kind === "npc" ? buildNpcModel(e.type, color) : buildMonsterModel(e.type, color);
    group.add(model);
    // Mark the whole group so any part of the model is clickable for attack/talk.
    group.userData.entityId = e.id;
    group.userData.entityKind = e.kind;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 80;
    const plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }),
    );
    plate.position.y = e.type === "golem" ? 2.9 : lowSlung ? 1.5 : 2.1;
    plate.scale.set(2.2, 0.7, 1);
    group.add(plate);

    const vis: EntityVisual = {
      group,
      plate,
      canvas,
      ctx: canvas.getContext("2d")!,
      lastHp: e.hp,
      target: new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z),
      tYaw: e.yaw,
      phase: Math.random() * Math.PI * 2,
      moveEnergy: 0,
      limbs: this.collectLimbs(group),
    };
    group.position.copy(vis.target); // snap on first sight
    group.rotation.y = e.yaw;
    this.drawPlate(vis, e);
    return vis;
  }

  /** A soft translucent disc on the ground to anchor a character (cheap shadow). */
  private makeBlob(radius: number): THREE.Mesh {
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    return blob;
  }

  private drawPlate(vis: EntityVisual, e: EntitySnapshot): void {
    const ctx = vis.ctx;
    ctx.clearRect(0, 0, 256, 80);
    ctx.fillStyle = e.kind === "npc" ? "#7fd0ff" : e.type === "golem" ? "#c9a2ff" : "#ffe066";
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
    return { goblin: "#5a7d3a", wolf: "#9aa0a8", scorpion: "#b5803a", skeleton: "#dcd8c8", golem: "#7a86c8" }[type] ?? "#aa4444";
  }
  private npcColor(role: string): string {
    return { banker: "#3a6ea5", shop: "#a5673a", quest: "#7a3a8a" }[role] ?? "#888888";
  }

  /** Entity under the crosshair (screen center), or null. */
  pickEntity(maxDist = 12): { id: string; kind: string; dist: number } | null {
    this.raycaster.setFromCamera(this.center, this.camera);
    const groups = [...this.entityVisuals.values()].map((v) => v.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      if (h.distance > maxDist) break;
      // Walk up to the entity group (which carries the id/kind).
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.entityId) return { id: o.userData.entityId, kind: o.userData.entityKind, dist: h.distance };
        o = o.parent;
      }
    }
    return null;
  }

  // ---- Splats & particles ----

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
    if (!vis) return;
    this.spawnSplat(vis.group.position, dmg);
    if (dmg > 0) {
      this.spawnBurst(this.tmpV.copy(vis.group.position).add(new THREE.Vector3(0, 1, 0)), "#e23b2e", { count: 10, speed: 2, life: 0.45, size: 0.07 });
    }
  }

  /** Spray a burst of colored particles (block debris, sparks, celebrations). */
  spawnBurst(
    pos: { x: number; y: number; z: number },
    color: string,
    opts: { count?: number; speed?: number; life?: number; gravity?: number; size?: number } = {},
  ): void {
    const { count = 14, speed = 2.6, life = 0.7, gravity = 7, size = 0.09 } = opts;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const theta = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = speed * (0.4 + Math.random() * 0.6);
      velocities[i * 3] = Math.cos(theta) * s * (1 - up * 0.5);
      velocities[i * 3 + 1] = up * s * 1.2;
      velocities[i * 3 + 2] = Math.sin(theta) * s * (1 - up * 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false }),
    );
    this.scene.add(points);
    this.bursts.push({ points, velocities, age: 0, life, gravity });
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.attributes.position.array as Float32Array;
      for (let p = 0; p < b.velocities.length; p += 3) {
        b.velocities[p + 1] -= b.gravity * dt;
        pos[p] += b.velocities[p] * dt;
        pos[p + 1] += b.velocities[p + 1] * dt;
        pos[p + 2] += b.velocities[p + 2] * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - b.age / b.life;
    }
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

  // ---- First-person viewmodel ----

  /** Show a held tool/weapon/block ("pickaxe"|"axe"|"shovel"|"sword"|"block"|"hand"). */
  setHeld(kind: string, color: string): void {
    const key = `${kind}:${color}`;
    if (key === this.heldKey) return;
    this.heldKey = key;
    for (const child of [...this.heldGroup.children]) {
      this.heldGroup.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.heldGroup.add(buildHeldModel(kind, color));
  }

  /** While true (mining/attacking held), the viewmodel swings continuously. */
  setHeldActive(active: boolean): void {
    this.heldActive = active;
  }

  /** One-shot swing (placing a block, clicking an attack). */
  triggerSwing(): void {
    this.swingT = 0;
  }

  private updateHeld(dt: number): void {
    // Walk bob from horizontal camera motion.
    const moved = this.tmpV.copy(this.camera.position).sub(this.lastCamPos);
    this.lastCamPos.copy(this.camera.position);
    const speed = Math.hypot(moved.x, moved.z) / Math.max(dt, 0.001);
    this.bobPhase += dt * Math.min(speed, 6) * 1.8;

    if (this.heldActive && this.swingT >= 1) this.swingT = 0;
    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt / 0.3);
    const swing = Math.sin(this.swingT * Math.PI); // 0→1→0 arc

    this.heldGroup.position.set(
      0.38 + Math.sin(this.bobPhase) * 0.015,
      -0.34 + Math.abs(Math.cos(this.bobPhase)) * 0.02 - swing * 0.06,
      -0.6 - swing * 0.08,
    );
    this.heldGroup.rotation.set(-0.2 - swing * 1.1, 0.25 + swing * 0.25, 0.05);
  }

  // ---- Per-frame animation ----

  private animateVisual(vis: AnimState & { group: THREE.Group }, dt: number): void {
    const cur = vis.group.position;
    const d = this.tmpV.copy(vis.target).sub(cur);
    const dist = d.length();
    if (dist > 8) cur.copy(vis.target); // teleport (respawn etc.)
    else cur.addScaledVector(d, 1 - Math.exp(-10 * dt));
    vis.group.rotation.y = lerpAngle(vis.group.rotation.y, vis.tYaw, 1 - Math.exp(-12 * dt));

    const moving = dist > 0.06;
    vis.moveEnergy = THREE.MathUtils.lerp(vis.moveEnergy, moving ? 1 : 0, 1 - Math.exp(-8 * dt));
    if (vis.moveEnergy > 0.01) {
      vis.phase += dt * 8 * Math.min(1, dist * 3 + 0.4);
      for (const limb of vis.limbs) {
        const tag = limb.userData.limb as string;
        if (tag === "tail") limb.rotation.y = Math.sin(vis.phase * 1.6) * 0.35 * (0.3 + vis.moveEnergy);
        else limb.rotation.x = limbSwing(tag, vis.phase, vis.moveEnergy);
      }
    }
  }

  render(dt: number): void {
    this.updateDayNight(dt);
    this.updateSplats();
    this.updateBursts(dt);
    this.updateHeld(dt);
    for (const vis of this.playerMeshes.values()) this.animateVisual(vis, dt);
    for (const vis of this.entityVisuals.values()) this.animateVisual(vis, dt);
    this.sky.position.copy(this.camera.position); // keep the dome centered on us
    this.renderer.render(this.scene, this.camera);
  }
}
