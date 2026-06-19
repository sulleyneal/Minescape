// The game server: owns connected players, routes client messages, runs the
// RuneScape-style action tick, and simulates the world — gathering, crafting,
// combat with monsters, NPC dialogue, banking, shops, and quests.

import { WebSocket } from "ws";
import { BlockType, BLOCKS } from "../shared/blocks";
import { CHUNK_SIZE, MAX_PLAYERS, TICK_MS, VIEW_RADIUS } from "../shared/constants";
import { MonsterDef, NPCS, QUESTS, questByGiver, SHOP } from "../shared/entities";
import { nodeForBlock, recipeById } from "../shared/gathering";
import { bestTool, bestWeapon, ITEMS } from "../shared/items";
import { ClientMessage, EntitySnapshot, ServerMessage, Vec3 } from "../shared/protocol";
import { emptySkills, levelForXp, maxHitpoints, SkillId, Skills } from "../shared/skills";
import { addItem, countItem, hasSpaceFor, Inventory, removeItem, startingInventory } from "./inventory";
import { MonsterEntity, NpcEntity, rollLoot, spawnWorldEntities, WorldEntities } from "./entities";
import { findSpawn } from "./spawn";
import { World } from "./world";

const PLAYER_ATTACK_TICKS = 3; // ~1.8s between swings
const MELEE_RANGE = 2.4;
const GIVE_UP_RANGE = 16;
const REGEN_TICKS = 12; // +1 hp roughly every 7s
const BANK_SLOTS = 240;
const MONSTER_COUNT = 70;
const ENTITY_VIEW = 64;
const SNAPSHOT_EVERY = 2;

interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  pos: Vec3;
  yaw: number;
  inventory: Inventory;
  bank: Inventory;
  skills: Skills;
  hp: number;
  dead: boolean;
  sentChunks: Set<string>;
  gathering: { x: number; y: number; z: number } | null;
  combatTargetId: string | null;
  lastAttackTick: number;
  lastRegenTick: number;
  questProgress: Record<string, number>;
  questActive: Set<string>;
  questDone: Set<string>;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function horizDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function randInt(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

let nextId = 1;

export class GameServer {
  private world: World;
  private players = new Map<string, Player>();
  private entities: WorldEntities;
  private tick = 0;

  constructor(seed: number) {
    this.world = new World(seed);
    this.entities = spawnWorldEntities(this.world, MONSTER_COUNT);
    setInterval(() => this.onTick(), TICK_MS);
    console.log(
      `[minescape] world ready (seed ${this.world.seed}); ${this.entities.monsters.size} monsters, ${this.entities.npcs.size} NPCs`,
    );
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
    const skills = emptySkills();
    const player: Player = {
      id,
      name: `Player ${id}`,
      socket,
      pos: this.findSpawn(),
      yaw: 0,
      inventory: startingInventory(),
      bank: new Array(BANK_SLOTS).fill(null),
      skills,
      hp: maxHitpoints(skills),
      dead: false,
      sentChunks: new Set(),
      gathering: null,
      combatTargetId: null,
      lastAttackTick: 0,
      lastRegenTick: 0,
      questProgress: {},
      questActive: new Set(),
      questDone: new Set(),
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
    return findSpawn(this.world);
  }

  private send(player: Player, msg: ServerMessage): void {
    if (player.socket.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify(msg));
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
      case "attack":
        this.onAttack(player, msg.id);
        break;
      case "talk":
        this.onTalk(player, msg.id);
        break;
      case "dialogueChoice":
        this.onDialogueChoice(player, msg.npc, msg.option);
        break;
      case "bankAction":
        this.onBankAction(player, msg);
        break;
      case "shopAction":
        this.onShopAction(player, msg);
        break;
      case "respawn":
        this.onRespawn(player);
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
      hp: player.hp,
      maxHp: maxHitpoints(player.skills),
    });
    this.streamChunks(player);
    this.sendEntities(player);
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

  // ---- Mining / building ----

  private onBlockEdit(player: Player, x: number, y: number, z: number, block: BlockType): void {
    const current = this.world.getBlock(x, y, z);
    if (block === BlockType.Air) {
      if (current === BlockType.Bedrock || current === BlockType.Air) return;
      if (World.isGatherable(current) && current !== BlockType.Leaves) {
        this.onGather(player, x, y, z);
        return;
      }
      const def = BLOCKS[current];
      if (def.requiresTool && !bestTool(player.inventory, def.tool)) {
        this.send(player, { t: "notice", text: `You need a ${def.tool} to break ${def.name}.` });
        return;
      }
      const drop = def.drops;
      if (drop && hasSpaceFor(player.inventory, drop)) {
        addItem(player.inventory, drop, 1);
        this.send(player, { t: "inventory", inventory: player.inventory });
      }
      this.applyEdit(x, y, z, BlockType.Air);
    } else {
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
    if (node.tool !== "hand" && !bestTool(player.inventory, node.tool)) {
      this.send(player, { t: "notice", text: `You need a ${node.tool} to gather that.` });
      player.gathering = null;
      return;
    }
    player.gathering = { x, y, z };
  }

  private onCraft(player: Player, recipeId: string): void {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    for (const inp of recipe.inputs) {
      if (countItem(player.inventory, inp.item) < inp.count) {
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
    if (xp <= 0) return;
    const before = levelForXp(player.skills[skill]);
    player.skills[skill] += xp;
    const after = levelForXp(player.skills[skill]);
    this.send(player, { t: "skill", skill, xp: player.skills[skill], levelUp: after > before, level: after });
    if (skill === SkillId.Hitpoints && after > before) {
      // Leveling Hitpoints raises the cap; top the player up a little.
      this.send(player, { t: "health", hp: player.hp, maxHp: maxHitpoints(player.skills) });
    }
  }

  // ---- Combat ----

  private onAttack(player: Player, entityId: string): void {
    const m = this.entities.monsters.get(entityId);
    if (!m || !m.alive) return;
    if (player.dead) return;
    if (horizDist(player.pos, m.pos) > GIVE_UP_RANGE) {
      this.send(player, { t: "notice", text: `${m.def.name} is too far away.` });
      return;
    }
    player.combatTargetId = entityId;
  }

  private resolvePlayerCombat(player: Player): void {
    if (!player.combatTargetId || player.dead) return;
    const m = this.entities.monsters.get(player.combatTargetId);
    if (!m || !m.alive) {
      player.combatTargetId = null;
      return;
    }
    const d = horizDist(player.pos, m.pos);
    if (d > GIVE_UP_RANGE) {
      player.combatTargetId = null;
      return;
    }
    if (d > MELEE_RANGE) return; // walk closer to engage
    if (this.tick - player.lastAttackTick < PLAYER_ATTACK_TICKS) return;
    player.lastAttackTick = this.tick;
    m.targetPlayerId = player.id; // it fights back

    const weapon = bestWeapon(player.inventory);
    const atk = levelForXp(player.skills[SkillId.Attack]) + weapon.attack;
    const str = levelForXp(player.skills[SkillId.Strength]);
    const hitChance = Math.max(0.3, Math.min(0.95, 0.62 + (atk - m.def.defence) * 0.05));
    const maxHit = 1 + Math.floor((str - 1) / 3) + Math.floor(weapon.strength / 2);
    // Bias rolls upward a little so hits rarely splat 0 once you connect.
    const dmg = Math.random() < hitChance ? 1 + Math.floor(Math.random() * maxHit) : 0;

    m.hp = Math.max(0, m.hp - dmg);
    this.broadcast({ t: "hitsplat", id: m.id, dmg });
    if (dmg > 0) {
      this.awardXp(player, SkillId.Attack, dmg * 2);
      this.awardXp(player, SkillId.Strength, dmg * 2);
      this.awardXp(player, SkillId.Hitpoints, Math.round(dmg * 1.33));
    }
    if (m.hp <= 0) this.killMonster(m, player);
  }

  private killMonster(m: MonsterEntity, killer: Player): void {
    m.alive = false;
    m.respawnAtTick = this.tick + m.def.respawnTicks;
    m.targetPlayerId = null;
    for (const p of this.players.values()) if (p.combatTargetId === m.id) p.combatTargetId = null;

    const loot = rollLoot(m.def);
    const got: string[] = [];
    for (const drop of loot) {
      if (hasSpaceFor(killer.inventory, drop.item)) {
        addItem(killer.inventory, drop.item, drop.count);
        got.push(`${drop.count} ${ITEMS[drop.item]?.name ?? drop.item}`);
      }
    }
    if (got.length) this.send(killer, { t: "inventory", inventory: killer.inventory });
    this.send(killer, {
      t: "notice",
      text: `You defeat the ${m.def.name}!${got.length ? " Loot: " + got.join(", ") : ""}`,
    });

    this.advanceKillQuests(killer, m.def.id);
  }

  private applyPlayerDamage(player: Player, dmg: number, source: MonsterDef): void {
    player.hp = Math.max(0, player.hp - dmg);
    this.send(player, { t: "hitsplat", id: "", dmg });
    this.send(player, { t: "health", hp: player.hp, maxHp: maxHitpoints(player.skills) });
    if (player.hp <= 0) this.killPlayer(player, source);
  }

  private killPlayer(player: Player, source: MonsterDef): void {
    player.dead = true;
    player.combatTargetId = null;
    player.gathering = null;
    for (const m of this.entities.monsters.values()) if (m.targetPlayerId === player.id) m.targetPlayerId = null;
    this.send(player, { t: "notice", text: `You were slain by a ${source.name}.` });
    this.send(player, { t: "death" });
  }

  private onRespawn(player: Player): void {
    if (!player.dead) return;
    player.dead = false;
    player.hp = maxHitpoints(player.skills);
    player.pos = this.findSpawn();
    player.sentChunks.clear();
    this.send(player, { t: "respawned", spawn: player.pos, hp: player.hp });
    this.send(player, { t: "health", hp: player.hp, maxHp: maxHitpoints(player.skills) });
    this.streamChunks(player);
    this.broadcast({ t: "playerMoved", id: player.id, pos: player.pos, yaw: player.yaw }, player.id);
  }

  // ---- NPCs: dialogue, bank, shop, quests ----

  private npcById(entityId: string): NpcEntity | undefined {
    for (const n of this.entities.npcs.values()) if (n.id === entityId) return n;
    return undefined;
  }

  private onTalk(player: Player, entityId: string): void {
    const npc = this.npcById(entityId);
    if (!npc) return;
    if (horizDist(player.pos, npc.pos) > 5) {
      this.send(player, { t: "notice", text: `Move closer to ${npc.def.name}.` });
      return;
    }
    if (npc.def.role === "banker") {
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name, text: npc.def.greeting,
        options: [{ id: "open", label: "Open my bank" }, { id: "bye", label: "Goodbye" }],
      });
    } else if (npc.def.role === "shop") {
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name, text: npc.def.greeting,
        options: [{ id: "trade", label: "Let's trade" }, { id: "bye", label: "Goodbye" }],
      });
    } else if (npc.def.role === "quest") {
      this.sendQuestDialogue(player, npc);
    }
  }

  private sendQuestDialogue(player: Player, npc: NpcEntity): void {
    const quest = questByGiver("quest");
    if (!quest) return;
    if (player.questDone.has(quest.id)) {
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: "Thanks again, hero. The plains are safer because of you.",
        options: [{ id: "bye", label: "Farewell" }],
      });
      return;
    }
    if (!player.questActive.has(quest.id)) {
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name, text: quest.offerText,
        options: [{ id: "accept", label: "I'll do it" }, { id: "decline", label: "Not now" }],
      });
      return;
    }
    const progress = player.questProgress[quest.id] ?? 0;
    if (progress >= quest.killCount) {
      this.completeQuest(player, npc);
    } else {
      const remaining = quest.killCount - progress;
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: quest.progressText.replace("{n}", String(remaining)),
        options: [{ id: "bye", label: "I'm on it" }],
      });
    }
  }

  private completeQuest(player: Player, npc: NpcEntity): void {
    const quest = questByGiver("quest")!;
    player.questActive.delete(quest.id);
    player.questDone.add(quest.id);
    addItem(player.inventory, "coins", quest.rewardCoins);
    if (quest.rewardItem) addItem(player.inventory, quest.rewardItem, 1);
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.awardXp(player, quest.rewardXp.skill, quest.rewardXp.amount);
    this.send(player, {
      t: "dialogue", npc: npc.id, name: npc.def.name, text: quest.completeText,
      options: [{ id: "bye", label: "Thank you" }],
    });
    this.send(player, { t: "quest", id: quest.id, name: quest.name, status: "complete", progress: quest.killCount, goal: quest.killCount });
  }

  private advanceKillQuests(player: Player, monsterId: string): void {
    for (const quest of QUESTS) {
      if (!player.questActive.has(quest.id) || quest.killMonster !== monsterId) continue;
      const progress = Math.min(quest.killCount, (player.questProgress[quest.id] ?? 0) + 1);
      player.questProgress[quest.id] = progress;
      this.send(player, {
        t: "quest", id: quest.id, name: quest.name,
        status: progress >= quest.killCount ? "complete" : "active", progress, goal: quest.killCount,
      });
      if (progress >= quest.killCount) {
        this.send(player, { t: "notice", text: `Quest: return to ${this.npcName(quest.giver)} to claim your reward!` });
      }
    }
  }

  private npcName(role: string): string {
    return NPCS.find((n) => n.id === role)?.name ?? "the quest giver";
  }

  private onDialogueChoice(player: Player, npcId: string, option: string): void {
    const npc = this.npcById(npcId);
    if (!npc) return;
    if (option === "bye" || option === "decline") {
      this.send(player, { t: "closeUi", ui: "dialogue" });
      return;
    }
    if (option === "open" && npc.def.role === "banker") {
      this.send(player, { t: "closeUi", ui: "dialogue" });
      this.send(player, { t: "bank", items: player.bank });
    } else if (option === "trade" && npc.def.role === "shop") {
      this.send(player, { t: "closeUi", ui: "dialogue" });
      this.send(player, { t: "shop", name: SHOP.name, entries: SHOP.entries.map((e) => ({ item: e.item, price: e.price })) });
    } else if (option === "accept" && npc.def.role === "quest") {
      const quest = questByGiver("quest")!;
      player.questActive.add(quest.id);
      player.questProgress[quest.id] = 0;
      this.send(player, { t: "quest", id: quest.id, name: quest.name, status: "active", progress: 0, goal: quest.killCount });
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: "Good hunting. The goblins lurk in the plains and forests.",
        options: [{ id: "bye", label: "I won't fail" }],
      });
    }
  }

  private onBankAction(player: Player, msg: Extract<ClientMessage, { t: "bankAction" }>): void {
    if (msg.action === "close") return;
    if (msg.action === "deposit" && msg.slot !== undefined) {
      const stack = player.inventory[msg.slot];
      if (!stack) return;
      const count = Math.min(stack.count, msg.count);
      // Tools/weapons are fine to bank; everything stacks in the bank.
      addItem(player.bank, stack.item, count);
      removeItem(player.inventory, stack.item, count);
    } else if (msg.action === "withdraw" && msg.item) {
      const have = countItem(player.bank, msg.item);
      const count = Math.min(have, msg.count);
      if (count <= 0 || !hasSpaceFor(player.inventory, msg.item)) return;
      removeItem(player.bank, msg.item, count);
      addItem(player.inventory, msg.item, count);
    }
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.send(player, { t: "bank", items: player.bank });
  }

  private onShopAction(player: Player, msg: Extract<ClientMessage, { t: "shopAction" }>): void {
    if (msg.action === "close") return;
    if (msg.action === "buy" && msg.item) {
      const entry = SHOP.entries.find((e) => e.item === msg.item);
      if (!entry) return;
      const count = Math.max(1, msg.count);
      const cost = entry.price * count;
      if (countItem(player.inventory, "coins") < cost) {
        this.send(player, { t: "notice", text: "You don't have enough coins." });
        return;
      }
      if (!hasSpaceFor(player.inventory, msg.item)) {
        this.send(player, { t: "notice", text: "Your inventory is full." });
        return;
      }
      removeItem(player.inventory, "coins", cost);
      addItem(player.inventory, msg.item, count);
      this.send(player, { t: "notice", text: `Bought ${count} ${ITEMS[msg.item]?.name} for ${cost} coins.` });
    } else if (msg.action === "sell" && msg.slot !== undefined) {
      const stack = player.inventory[msg.slot];
      if (!stack) return;
      const def = ITEMS[stack.item];
      if (!def?.value || stack.item === "coins") {
        this.send(player, { t: "notice", text: "You can't sell that." });
        return;
      }
      const count = Math.min(stack.count, Math.max(1, msg.count));
      const gain = Math.max(1, Math.floor(def.value * 0.6)) * count;
      removeItem(player.inventory, stack.item, count);
      addItem(player.inventory, "coins", gain);
      this.send(player, { t: "notice", text: `Sold ${count} ${def.name} for ${gain} coins.` });
    }
    this.send(player, { t: "inventory", inventory: player.inventory });
  }

  // ---- Entity snapshots ----

  private sendEntities(player: Player): void {
    const list: EntitySnapshot[] = [];
    for (const m of this.entities.monsters.values()) {
      if (!m.alive) continue;
      if (horizDist(player.pos, m.pos) > ENTITY_VIEW) continue;
      list.push({ id: m.id, kind: "monster", type: m.def.id, name: m.def.name, pos: m.pos, yaw: m.yaw, hp: m.hp, maxHp: m.def.maxHp, level: m.def.level });
    }
    for (const n of this.entities.npcs.values()) {
      if (horizDist(player.pos, n.pos) > ENTITY_VIEW) continue;
      list.push({ id: n.id, kind: "npc", type: n.def.role, name: n.def.name, pos: n.pos, yaw: n.yaw, hp: 1, maxHp: 1 });
    }
    this.send(player, { t: "entities", entities: list });
  }

  // ---- Tick ----

  private onTick(): void {
    this.tick++;

    this.tickGathering();
    for (const r of this.world.tickRespawns(this.tick)) {
      this.broadcast({ t: "worldEdit", x: r.x, y: r.y, z: r.z, block: r.block });
    }

    // Player-initiated combat.
    for (const player of this.players.values()) this.resolvePlayerCombat(player);

    this.tickMonsters();
    this.tickRegen();

    // Periodic entity snapshots to every player.
    if (this.tick % SNAPSHOT_EVERY === 0) {
      for (const player of this.players.values()) this.sendEntities(player);
    }
  }

  private tickGathering(): void {
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
      const tool = node.tool === "hand" ? null : bestTool(player.inventory, node.tool);
      const toolBonus = tool ? (tool.tier - 1) * 0.12 : 0;
      const chance = Math.min(0.95, node.baseChance + (level - node.levelReq) * 0.01 + toolBonus);
      if (Math.random() < chance) {
        addItem(player.inventory, node.yields, 1);
        this.send(player, { t: "inventory", inventory: player.inventory });
        this.awardXp(player, node.skill, node.xp);
        this.send(player, { t: "notice", text: `You get some ${ITEMS[node.yields]?.name?.toLowerCase()}.` });
        if (node.respawnTicks > 0) {
          this.world.depleteNode(x, y, z, node.depletedBlock, node.respawnTicks, this.tick);
          this.broadcast({ t: "worldEdit", x, y, z, block: node.depletedBlock });
          player.gathering = null;
        }
      }
    }
  }

  private nearestPlayer(pos: Vec3, range: number): Player | null {
    let best: Player | null = null;
    let bestD = range;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = horizDist(pos, p.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private tickMonsters(): void {
    for (const m of this.entities.monsters.values()) {
      if (!m.alive) {
        if (this.tick >= m.respawnAtTick) {
          m.alive = true;
          m.hp = m.def.maxHp;
          m.pos = { ...m.spawn };
          m.targetPlayerId = null;
        }
        continue;
      }

      // Acquire / validate a target.
      let target = m.targetPlayerId ? this.players.get(m.targetPlayerId) : undefined;
      if ((!target || target.dead) && m.def.aggressive) {
        const near = this.nearestPlayer(m.pos, m.def.aggroRange);
        if (near) {
          m.targetPlayerId = near.id;
          target = near;
        }
      }

      if (target && !target.dead) {
        const d = horizDist(m.pos, target.pos);
        if (d <= MELEE_RANGE) {
          m.yaw = Math.atan2(target.pos.x - m.pos.x, target.pos.z - m.pos.z);
          if (this.tick - m.lastAttackTick >= m.def.attackTicks) {
            m.lastAttackTick = this.tick;
            const defLevel = levelForXp(target.skills[SkillId.Defence]);
            const hitChance = Math.max(0.1, Math.min(0.9, 0.5 + (m.def.attack - defLevel) * 0.04));
            const dmg = Math.random() < hitChance ? randInt(m.def.maxHit) : 0;
            this.applyPlayerDamage(target, dmg, m.def);
          }
        } else if (d <= GIVE_UP_RANGE) {
          this.stepToward(m, target.pos, 0.3);
        } else {
          m.targetPlayerId = null;
        }
      } else {
        m.targetPlayerId = null;
        this.wander(m);
      }
    }
  }

  private stepToward(m: MonsterEntity, target: Vec3, speed: number): void {
    const dx = target.x - m.pos.x;
    const dz = target.z - m.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    m.pos.x += (dx / len) * speed;
    m.pos.z += (dz / len) * speed;
    m.pos.y = this.world.heightAt(Math.floor(m.pos.x), Math.floor(m.pos.z)) + 1;
    m.yaw = Math.atan2(dx, dz);
  }

  private wander(m: MonsterEntity): void {
    if (m.headingTicks <= 0) {
      m.heading = Math.random() * Math.PI * 2;
      m.headingTicks = 4 + Math.floor(Math.random() * 8);
      if (Math.random() < 0.4) m.headingTicks = 0; // sometimes just pause
    }
    m.headingTicks--;
    // Stay near the spawn (leash).
    if (horizDist(m.pos, m.spawn) > 9) m.heading = Math.atan2(m.spawn.x - m.pos.x, m.spawn.z - m.pos.z);
    const speed = 0.12;
    m.pos.x += Math.sin(m.heading) * speed;
    m.pos.z += Math.cos(m.heading) * speed;
    m.pos.y = this.world.heightAt(Math.floor(m.pos.x), Math.floor(m.pos.z)) + 1;
    m.yaw = m.heading;
  }

  private tickRegen(): void {
    for (const player of this.players.values()) {
      if (player.dead) continue;
      const max = maxHitpoints(player.skills);
      if (player.hp < max && this.tick - player.lastRegenTick >= REGEN_TICKS) {
        player.lastRegenTick = this.tick;
        player.hp = Math.min(max, player.hp + 1);
        this.send(player, { t: "health", hp: player.hp, maxHp: max });
      }
    }
  }
}
