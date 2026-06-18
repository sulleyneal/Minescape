// Top-level orchestration: connects the network, world, renderer, controls and
// HUD, routes server messages into state, and runs the render/update loop.

import * as THREE from "three";
import { BlockType, BLOCKS } from "../../shared/blocks";
import { CHUNK_SIZE } from "../../shared/constants";
import { nodeForBlock } from "../../shared/gathering";
import { bestTool, ITEMS, ItemStack } from "../../shared/items";
import { ServerMessage } from "../../shared/protocol";
import { breakTime } from "../../shared/tools";
import { Controls, RaycastHit } from "./controls";
import { Hud } from "./hud";
import { Net } from "./net";
import { Renderer } from "./renderer";
import { isTouchDevice, TouchControls } from "./touch";
import { ClientWorld } from "./world";

export class Game {
  private world = new ClientWorld();
  private renderer: Renderer;
  private controls: Controls;
  private hud: Hud;
  private net = new Net();
  private myId = "";
  /** True once the spawn chunk has loaded and physics has been enabled. */
  private spawned = false;
  /** Local copy of the inventory, for tool lookups during mining. */
  private inventory: (ItemStack | null)[] = [];
  private mineKey = "";
  private mineProgress = 0;
  private gatherKey = "";
  private lastMoveSent = 0;
  private lastPos = new THREE.Vector3();
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, private playerName: string) {
    this.renderer = new Renderer(canvas, this.world);
    this.hud = new Hud(hudRoot, (m) => this.net.send(m));
    this.controls = new Controls(canvas, this.renderer.camera, this.world, () => this.hud.isTyping());

    this.controls.onSecondary = (hit) => this.onSecondary(hit);

    // Phones/tablets get on-screen joystick + action buttons.
    if (isTouchDevice()) new TouchControls(this.controls, canvas, hudRoot);
  }

  async start(): Promise<void> {
    await this.net.connect();
    this.net.onMessage((m) => this.onMessage(m));
    this.net.send({ t: "join", name: this.playerName });
    this.loop();
  }

  // Resolve the held mine/break action. Terrain blocks accumulate break
  // progress (scaled by hardness and the best matching tool); tree/ore/water
  // delegate to the server's gathering tick.
  private updateMining(dt: number): void {
    if (!this.controls.primaryHeld) {
      this.resetMining();
      return;
    }
    const hit = this.controls.raycast();
    if (!hit) {
      this.resetMining();
      return;
    }
    const block = this.world.getBlock(hit.x, hit.y, hit.z);
    const key = `${hit.x},${hit.y},${hit.z}`;

    // Trees / ore / water: the server runs the RuneScape-style gather tick.
    if (nodeForBlock(block) && block !== BlockType.Leaves) {
      if (this.gatherKey !== key) {
        this.gatherKey = key;
        this.net.send({ t: "gather", x: hit.x, y: hit.y, z: hit.z });
      }
      this.hud.setMineProgress(-1); // server-driven; hide local bar
      return;
    }
    this.gatherKey = "";

    const def = BLOCKS[block];
    if (def.hardness === 0 || block === BlockType.Air) {
      this.resetMining();
      return;
    }
    const tool = bestTool(this.inventory, def.tool);
    const time = breakTime(def.hardness, def.tool, def.requiresTool, tool);
    if (!isFinite(time)) {
      if (this.mineKey !== key) {
        this.mineKey = key;
        this.hud.notice(def.requiresTool ? `You need a ${def.tool} to break ${def.name}.` : "You can't break that.");
      }
      this.hud.setMineProgress(0);
      return;
    }

    if (this.mineKey !== key) {
      this.mineKey = key;
      this.mineProgress = 0;
    }
    this.mineProgress += dt / time;
    this.hud.setMineProgress(Math.min(1, this.mineProgress));
    if (this.mineProgress >= 1) {
      this.net.send({ t: "blockEdit", x: hit.x, y: hit.y, z: hit.z, block: BlockType.Air });
      this.mineProgress = 0;
      this.mineKey = ""; // wait for the next target
    }
  }

  private resetMining(): void {
    this.mineKey = "";
    this.gatherKey = "";
    this.mineProgress = 0;
    this.hud.setMineProgress(0);
  }

  private onSecondary(hit: RaycastHit | null): void {
    if (!hit) return;
    const item = this.hud.selectedItem();
    if (!item) {
      this.hud.notice("Select a placeable item in your pack first.");
      return;
    }
    const block = ITEMS[item].placeBlock!;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    // Don't build inside ourselves.
    const feetX = Math.floor(this.controls.pos.x);
    const feetZ = Math.floor(this.controls.pos.z);
    const feetY = Math.floor(this.controls.pos.y);
    if (x === feetX && z === feetZ && (y === feetY || y === feetY + 1)) return;
    this.net.send({ t: "blockEdit", x, y, z, block });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case "welcome":
        this.myId = m.id;
        this.controls.pos.set(m.spawn.x, m.spawn.y, m.spawn.z);
        this.inventory = m.inventory;
        this.hud.setInventory(m.inventory);
        this.hud.setSkills(m.skills);
        for (const p of m.players) this.renderer.upsertPlayer(p.id, p.name, p.pos, p.yaw);
        this.hud.notice("Welcome to Minescape! Press H for help.");
        break;
      case "chunk":
        this.world.setChunk(m.cx, m.cz, m.data);
        break;
      case "worldEdit":
        this.world.setBlock(m.x, m.y, m.z, m.block);
        break;
      case "playerJoined":
        this.renderer.upsertPlayer(m.player.id, m.player.name, m.player.pos, m.player.yaw);
        this.hud.notice(`${m.player.name} joined.`);
        break;
      case "playerMoved":
        this.renderer.upsertPlayer(m.id, m.id, m.pos, m.yaw);
        break;
      case "playerLeft":
        this.renderer.removePlayer(m.id);
        break;
      case "inventory":
        this.inventory = m.inventory;
        this.hud.setInventory(m.inventory);
        break;
      case "skill":
        this.hud.updateSkill(m.skill, m.xp, m.levelUp);
        break;
      case "chat":
        this.hud.chat(m.from, m.text);
        break;
      case "notice":
        this.hud.notice(m.text);
        break;
    }
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // Don't run physics until the chunk we're standing in has loaded — otherwise
    // gravity drops us through a still-empty world and we get buried when it pops in.
    const cx = Math.floor(this.controls.pos.x / CHUNK_SIZE);
    const cz = Math.floor(this.controls.pos.z / CHUNK_SIZE);
    if (this.world.hasChunk(cx, cz)) {
      if (!this.spawned) {
        this.spawned = true;
        this.controls.ensureNotStuck();
      }
      this.controls.update(dt);
      this.updateMining(dt);
    } else {
      this.controls.placeCamera();
    }
    this.renderer.setHighlight(this.spawned ? this.controls.raycast() : null);
    this.renderer.syncChunks();
    this.renderer.render();

    // Throttle movement updates and only send when actually moving/turning.
    const now = performance.now();
    if (now - this.lastMoveSent > 80) {
      const p = this.controls.pos;
      if (p.distanceToSquared(this.lastPos) > 0.0004 || this.movedView()) {
        this.net.send({ t: "move", pos: { x: p.x, y: p.y, z: p.z }, yaw: this.controls.yaw });
        this.lastPos.copy(p);
        this.lastYaw = this.controls.yaw;
        this.lastMoveSent = now;
      }
    }
  };

  private lastYaw = 0;
  private movedView(): boolean {
    return Math.abs(this.controls.yaw - this.lastYaw) > 0.02;
  }
}
