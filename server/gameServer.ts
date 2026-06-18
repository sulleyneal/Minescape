// The game server: owns connected players, routes client messages, runs the
// RuneScape-style action tick, and broadcasts world/skill changes.

import { WebSocket } from "ws";
import { BlockType, BLOCKS, isSolid } from "../shared/blocks";
import { CHUNK_SIZE, MAX_PLAYERS, TICK_MS, VIEW_RADIUS } from "../shared/constants";
import { GATHER_NODES, nodeForBlock, recipeById } from "../shared/gathering";
import { ITEMS } from "../shared/items";
import { ClientMessage, ServerMessage, Vec3 } from "../shared/protocol";
import { emptySkills, levelForXp, SkillId, Skills } from "../shared/skills";
import { addItem, emptyInventory, hasSpaceFor, Inventory, removeItem } from "./inventory";
import { World } from "./world";

interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  pos: Vec3;
  yaw: number;
  inventory: Inventory;
  skills: Skills;
  sentChunks: Set<string>;
  /** Active gathering action, processed once per tick. */
  gathering: { x: number; y: number; z: number } | null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

let nextId = 1;

export class GameServer {
  private world: World;
  private players = new Map<string, Player>();
  private tick = 0;

  constructor(seed: number) {
    this.world = new World(seed);
    setInterval(() => this.onTick(), TICK_MS);
    console.log(`[minescape] world ready (seed ${this.world.seed})`);
  }

  get playerCount(): number {
    return this.players.size;
  }

  handleConnection(socket: WebSocket): void {
    if (this.players.size >= MAX_PLAYERS) {
      socket.close(1013, "Server full (max 8 players)");
      return;
    }

    const id = `p${nextId++}`;
    const player: Player = {
      id,
      name: `Player ${id}`,
      socket,
      pos: this.findSpawn(),
      yaw: 0,
      inventory: emptyInventory(),
      skills: emptySkills(),
      sentChunks: new Set(),
      gathering: null,
    };
    this.players.set(id, player);

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(player, msg);
    });

    socket.on("close", () => {
      this.players.delete(id);
      this.broadcast({ t: "playerLeft", id }, id);
      console.log(`[minescape] ${player.name} left (${this.players.size} online)`);
    });
  }

  private findSpawn(): Vec3 {
    // Drop the player onto the highest solid block near the world origin.
    for (let y = 63; y > 0; y--) {
      if (isSolid(this.world.getBlock(0, y, 0))) {
        return { x: 0.5, y: y + 2, z: 0.5 };
      }
    }
    return { x: 0.5, y: 40, z: 0.5 };
  }

  private send(player: Player, msg: ServerMessage): void {
    if (player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerMessage, exceptId?: string): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      if (p.socket.readyState === WebSocket.OPEN) p.socket.send(data);
    }
  }

  private handleMessage(player: Player, msg: ClientMessage): void {
    switch (msg.t) {
      case "join":
        this.onJoin(player, msg.name);
        break;
      case "move":
        player.pos = msg.pos;
        player.yaw = msg.yaw;
        this.streamChunks(player);
        this.broadcast({ t: "playerMoved", id: player.id, pos: msg.pos, yaw: msg.yaw }, player.id);
        break;
      case "blockEdit":
        this.onBlockEdit(player, msg.x, msg.y, msg.z, msg.block);
        break;
      case "gather":
        this.onGather(player, msg.x, msg.y, msg.z);
        break;
      case "craft":
        this.onCraft(player, msg.recipe);
        break;
      case "chat":
        this.broadcast({ t: "chat", from: player.name, text: msg.text.slice(0, 200) });
        break;
    }
  }

  private onJoin(player: Player, name: string): void {
    player.name = (name || player.name).slice(0, 16);
    this.send(player, {
      t: "welcome",
      id: player.id,
      seed: this.world.seed,
      spawn: player.pos,
      players: [...this.players.values()]
        .filter((p) => p.id !== player.id)
        .map((p) => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw })),
      inventory: player.inventory,
      skills: player.skills,
    });
    this.streamChunks(player);
    this.broadcast(
      { t: "playerJoined", player: { id: player.id, name: player.name, pos: player.pos, yaw: player.yaw } },
      player.id,
    );
    console.log(`[minescape] ${player.name} joined (${this.players.size} online)`);
  }

  private streamChunks(player: Player): void {
    const pcx = Math.floor(player.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(player.pos.z / CHUNK_SIZE);
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        if (player.sentChunks.has(key)) continue;
        player.sentChunks.add(key);
        this.send(player, { t: "chunk", cx, cz, data: toBase64(this.world.getChunk(cx, cz)) });
      }
    }
  }

  private onBlockEdit(player: Player, x: number, y: number, z: number, block: BlockType): void {
    const current = this.world.getBlock(x, y, z);
    if (block === BlockType.Air) {
      // Breaking a block: bedrock is indestructible; gatherable nodes go via gather.
      if (current === BlockType.Bedrock || current === BlockType.Air) return;
      if (World.isGatherable(current) && current !== BlockType.Leaves) {
        this.onGather(player, x, y, z);
        return;
      }
      const drop = BLOCKS[current].drops;
      if (drop && hasSpaceFor(player.inventory, drop)) {
        addItem(player.inventory, drop, 1);
        this.send(player, { t: "inventory", inventory: player.inventory });
      }
      this.applyEdit(x, y, z, BlockType.Air);
    } else {
      // Placing a block: must consume the matching item and target empty space.
      if (current !== BlockType.Air && current !== BlockType.Water) return;
      const itemId = Object.values(ITEMS).find((i) => i.placeBlock === block)?.id;
      if (!itemId || !removeItem(player.inventory, itemId, 1)) return;
      this.send(player, { t: "inventory", inventory: player.inventory });
      this.applyEdit(x, y, z, block);
    }
  }

  private applyEdit(x: number, y: number, z: number, block: BlockType): void {
    this.world.setBlock(x, y, z, block);
    this.broadcast({ t: "worldEdit", x, y, z, block });
  }

  private onGather(player: Player, x: number, y: number, z: number): void {
    const block = this.world.getBlock(x, y, z);
    const node = nodeForBlock(block);
    if (!node) return;
    const level = levelForXp(player.skills[node.skill]);
    if (level < node.levelReq) {
      this.send(player, { t: "notice", text: `You need ${node.skill} level ${node.levelReq} for that.` });
      player.gathering = null;
      return;
    }
    // Queue the action; resolved on the tick loop for that RuneScape cadence.
    player.gathering = { x, y, z };
  }

  private onCraft(player: Player, recipeId: string): void {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    for (const inp of recipe.inputs) {
      if (player.inventory.reduce((s, st) => (st && st.item === inp.item ? s + st.count : s), 0) < inp.count) {
        this.send(player, { t: "notice", text: `You don't have enough ${ITEMS[inp.item]?.name ?? inp.item}.` });
        return;
      }
    }
    if (recipe.skill && recipe.levelReq) {
      const level = levelForXp(player.skills[recipe.skill]);
      if (level < recipe.levelReq) {
        this.send(player, { t: "notice", text: `You need ${recipe.skill} level ${recipe.levelReq}.` });
        return;
      }
    }
    for (const inp of recipe.inputs) removeItem(player.inventory, inp.item, inp.count);
    addItem(player.inventory, recipe.output.item, recipe.output.count);
    if (recipe.skill && recipe.xp) this.awardXp(player, recipe.skill, recipe.xp);
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.send(player, { t: "notice", text: `You make ${recipe.output.count} ${ITEMS[recipe.output.item]?.name}.` });
  }

  private awardXp(player: Player, skill: SkillId, xp: number): void {
    const before = levelForXp(player.skills[skill]);
    player.skills[skill] += xp;
    const after = levelForXp(player.skills[skill]);
    this.send(player, {
      t: "skill",
      skill,
      xp: player.skills[skill],
      levelUp: after > before,
      level: after,
    });
  }

  private onTick(): void {
    this.tick++;

    // Resolve each player's active gathering action.
    for (const player of this.players.values()) {
      if (!player.gathering) continue;
      const { x, y, z } = player.gathering;
      const block = this.world.getBlock(x, y, z);
      const node = nodeForBlock(block);
      if (!node) {
        player.gathering = null;
        continue;
      }
      if (!hasSpaceFor(player.inventory, node.yields)) {
        this.send(player, { t: "notice", text: "Your inventory is full." });
        player.gathering = null;
        continue;
      }
      const level = levelForXp(player.skills[node.skill]);
      const chance = Math.min(0.95, node.baseChance + (level - node.levelReq) * 0.01);
      if (Math.random() < chance) {
        addItem(player.inventory, node.yields, 1);
        this.send(player, { t: "inventory", inventory: player.inventory });
        this.awardXp(player, node.skill, node.xp);
        this.send(player, { t: "notice", text: `You get some ${ITEMS[node.yields]?.name?.toLowerCase()}.` });
        // Trees/ore deplete; water (respawnTicks 0) is inexhaustible.
        if (node.respawnTicks > 0) {
          this.world.depleteNode(x, y, z, node.depletedBlock, node.respawnTicks, this.tick);
          this.broadcast({ t: "worldEdit", x, y, z, block: node.depletedBlock });
          player.gathering = null;
        }
      }
    }

    // Respawn any depleted resource nodes and tell everyone.
    for (const r of this.world.tickRespawns(this.tick)) {
      this.broadcast({ t: "worldEdit", x: r.x, y: r.y, z: r.z, block: r.block });
    }
  }
}
