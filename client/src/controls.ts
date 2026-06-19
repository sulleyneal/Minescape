// First-person controller: WASD + mouse-look (pointer lock), gravity, jumping,
// and swept-axis collision against solid voxels. Also raycasts the voxel grid
// to find which block the crosshair is pointing at.

import * as THREE from "three";
import { isSolid } from "../../shared/blocks";
import { WORLD_HEIGHT } from "../../shared/constants";
import { ClientWorld } from "./world";

const PLAYER_HALF = 0.3; // half width/depth
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const SPEED = 5.0; // blocks/sec
const GRAVITY = 24;
const JUMP = 8.2;
const REACH = 6;

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  /** Normal of the hit face — the empty neighbour where a placed block would go. */
  nx: number;
  ny: number;
  nz: number;
}

export class Controls {
  pos = new THREE.Vector3(0, 50, 0); // feet position
  private vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private onGround = false;
  private keys = new Set<string>();
  locked = false;

  // Touch/virtual input, fed by the on-screen controls on mobile.
  touchForward = 0; // -1..1
  touchStrafe = 0; // -1..1
  /** When set, auto-walk toward this world point (used to close on a combat
   *  target). Any manual movement input overrides it. */
  autoMove: THREE.Vector3 | null = null;
  /** True while the mine/break action is held (mouse or touch). */
  primaryHeld = false;
  private jumpQueued = false;

  onPrimary: ((hit: RaycastHit | null) => void) | null = null;
  onSecondary: ((hit: RaycastHit | null) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private world: ClientWorld,
    private isTyping: () => boolean,
  ) {
    this.bindEvents();
  }

  private get coarsePointer(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  }

  private bindEvents(): void {
    this.canvas.addEventListener("click", () => {
      // Pointer lock is desktop-only; on touch devices the on-screen controls drive looking.
      if (!this.locked && !this.coarsePointer) this.canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
    document.addEventListener("keydown", (e) => {
      if (this.isTyping()) return;
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      // Left button is held to mine (resolved each frame by the game loop);
      // right button places once.
      if (e.button === 0) this.primaryHeld = true;
      else if (e.button === 2) this.triggerSecondary();
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.primaryHeld = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- Virtual input API (used by on-screen touch controls) ----

  /** Rotate the view by a touch-drag delta (pixels). */
  applyLook(dx: number, dy: number): void {
    this.yaw -= dx * 0.004;
    this.pitch -= dy * 0.004;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  requestJump(): void {
    this.jumpQueued = true;
  }

  /** Fire the break/gather action at the current crosshair. */
  triggerPrimary(): void {
    this.onPrimary?.(this.raycast());
  }

  /** Fire the place action at the current crosshair. */
  triggerSecondary(): void {
    this.onSecondary?.(this.raycast());
  }

  private collides(x: number, y: number, z: number): boolean {
    const minX = Math.floor(x - PLAYER_HALF);
    const maxX = Math.floor(x + PLAYER_HALF);
    const minY = Math.floor(y);
    const maxY = Math.floor(y + PLAYER_HEIGHT);
    const minZ = Math.floor(z - PLAYER_HALF);
    const maxZ = Math.floor(z + PLAYER_HALF);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (isSolid(this.world.getBlock(bx, by, bz))) return true;
        }
      }
    }
    return false;
  }

  update(dt: number): void {
    // Desired horizontal movement relative to facing. Keyboard takes priority;
    // the virtual joystick fills in when no movement key is held.
    let forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    let strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    if (forward === 0 && strafe === 0) {
      forward = this.touchForward;
      strafe = this.touchStrafe;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward is -Z in three.js camera space
    let dx = strafe * cos - forward * sin;
    let dz = -strafe * sin - forward * cos;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx = (dx / len) * SPEED;
      dz = (dz / len) * SPEED;
    }
    this.vel.x = dx;
    this.vel.z = dz;

    // No manual input but a combat target set: stride toward it automatically.
    if (forward === 0 && strafe === 0 && this.autoMove) {
      const ax = this.autoMove.x - this.pos.x;
      const az = this.autoMove.z - this.pos.z;
      const alen = Math.hypot(ax, az);
      if (alen > 0.0001) {
        this.vel.x = (ax / alen) * SPEED;
        this.vel.z = (az / alen) * SPEED;
      }
    }

    this.vel.y -= GRAVITY * dt;
    if ((this.keys.has("Space") || this.jumpQueued) && this.onGround) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    this.jumpQueued = false;

    // Resolve each axis independently so we can slide along walls.
    const nx = this.pos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pos.y, this.pos.z)) this.pos.x = nx;
    else this.vel.x = 0;

    const nz = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, this.pos.y, nz)) this.pos.z = nz;
    else this.vel.z = 0;

    const ny = this.pos.y + this.vel.y * dt;
    if (!this.collides(this.pos.x, ny, this.pos.z)) {
      this.pos.y = ny;
      this.onGround = false;
    } else {
      if (this.vel.y < 0) this.onGround = true;
      this.vel.y = 0;
    }

    this.placeCamera();
  }

  /** Position the camera from the current pose without running physics — used
   *  while the spawn chunk is still streaming in. */
  placeCamera(): void {
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  /** If the player happens to be embedded in solid blocks (e.g. terrain loaded
   *  underneath them), lift them straight up until they're clear. */
  ensureNotStuck(): void {
    let guard = 0;
    while (this.collides(this.pos.x, this.pos.y, this.pos.z) && this.pos.y < WORLD_HEIGHT && guard++ < WORLD_HEIGHT) {
      this.pos.y += 1;
    }
    this.vel.set(0, 0, 0);
  }

  /** DDA voxel raycast from the eye along the view direction. */
  raycast(): RaycastHit | null {
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation).normalize();

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);

    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

    const distToBoundary = (o: number, s: number) => (s > 0 ? Math.ceil(o) - o : o - Math.floor(o));
    let tMaxX = dir.x !== 0 ? distToBoundary(origin.x, stepX) * tDeltaX : Infinity;
    let tMaxY = dir.y !== 0 ? distToBoundary(origin.y, stepY) * tDeltaY : Infinity;
    let tMaxZ = dir.z !== 0 ? distToBoundary(origin.z, stepZ) * tDeltaZ : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= REACH) {
      const block = this.world.getBlock(x, y, z);
      if (block !== 0) {
        return { x, y, z, nx, ny, nz };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  }
}
