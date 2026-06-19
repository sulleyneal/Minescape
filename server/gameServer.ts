// The game server: owns connected players, routes client messages, runs the
// RuneScape-style action tick, and simulates the world — gathering, crafting,
// combat with monsters, NPC dialogue, banking, shops, and quests.

import { WebSocket } from "ws";
import { sanitizeSkin } from "../shared/appearance";
import { BlockType, BLOCKS } from "../shared/blocks";
import { CHUNK_SIZE, MAX_PLAYERS, TICK_MS, VIEW_RADIUS } from "../shared/constants";
import { MonsterDef, NPCS, QuestDef, QUESTS, questsByGiver, SHOP } from "../shared/entities";
import { emptyEquipment, Equipment, equipmentBonuses, EQUIP_SLOTS, EquipSlot, gearFromEquipment } from "../shared/equipment";
import { GRID_SIZE, matchGrid } from "../shared/crafting";
import { nodeForBlock, recipeById } from "../shared/gathering";
import { bestTool, ITEMS } from "../shared/items";
import { ClientMessage, EntitySnapshot, ServerMessage, Skin, Vec3 } from "../shared/protocol";
import { emptySkills, levelForXp, maxHitpoints, SkillId, Skills } from "../shared/skills";
import { addItem, countItem, hasSpaceFor, Inventory, removeItem, startingInventory } from "./inventory";
import { MonsterEntity, NpcEntity, rollLoot, spawnWorldEntities, WorldEntities } from "./entities";
import { findSpawn } from "./spawn";
import { hashPassword, PlayerSave, SaveData, SAVE_VERSION, Storage, verifyPassword } from "./storage";
import { World } from "./world";

const PLAYER_ATTACK_TICKS = 3; // ~1.8s between swings
const MELEE_RANGE = 2.4;
const GIVE_UP_RANGE = 16;
const REGEN_TICKS = 12; // +1 hp roughly every 7s
const BANK_SLOTS = 240;
const GROW_TICKS = 100; // ~60s for a planted sapling to become a tree
const SAPLING_DROP_CHANCE = 0.2; // chance leaves yield a sapling when broken
const ENTITY_VIEW = 64;
const SNAPSHOT_EVERY = 2;
const AUTOSAVE_MS = 30_000;

interface Player {
  id: string;
  name: string;
  /** Persistence key (lowercased name); null until the player has joined. */
  accountKey: string | null;
  salt: string | null;
  passHash: string | null;
  skin: Skin;
  socket: WebSocket;
  pos: Vec3;
  yaw: number;
  inventory: Inventory;
  bank: Inventory;
  equipment: Equipment;
  /** Crafting grid contents (row-major, 9 cells). */
  craftGrid: Inventory;
  skills: Skills;
  hp: number;
  dead: boolean;
  loggedIn: boolean;
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

/** Return a fixed-length slot array from a (possibly shorter/undefined) saved one. */
function padSlots(arr: Inventory | undefined, n: number): Inventory {
  const out: Inventory = new Array(n).fill(null);
  if (arr) for (let i = 0; i < Math.min(arr.length, n); i++) out[i] = arr[i] ?? null;
  return out;
}

let nextId = 1;

export class GameServer {
  private world: World;
  private players = new Map<string, Player>();
  private entities: WorldEntities;
  private tick = 0;
  /** Persisted character records, keyed by lowercased name. */
  private accounts = new Map<string, PlayerSave>();
  /** Account key → live player id, to block duplicate logins. */
  private online = new Map<string, string>();

  constructor(save: SaveData | null, private storage: Storage, fallbackSeed: number) {
    const seed = save?.seed ?? fallbackSeed;
    this.world = new World(seed);
    this.world.loadEdits(save?.world);
    if (save) for (const [key, rec] of Object.entries(save.accounts)) this.accounts.set(key, rec);
    this.entities = spawnWorldEntities(this.world);
    setInterval(() => this.onTick(), TICK_MS);
    setInterval(() => this.saveNow(), AUTOSAVE_MS);
    console.log(
      `[minescape] world ready (seed ${this.world.seed}); ${this.entities.monsters.size} monsters, ${this.entities.npcs.size} NPCs; ${this.accounts.size} saved characters`,
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
      accountKey: null,
      salt: null,
      passHash: null,
      skin: { body: "#cc4444", head: "#e0b48a" },
      socket,
      pos: this.findSpawn(),
      yaw: 0,
      inventory: startingInventory(),
      bank: new Array(BANK_SLOTS).fill(null),
      equipment: emptyEquipment(),
      craftGrid: new Array(GRID_SIZE).fill(null),
      skills,
      hp: maxHitpoints(skills),
      dead: false,
      loggedIn: false,
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
      if (player.loggedIn && player.accountKey) {
        this.returnGrid(player); // don't lose items left in the crafting grid
        this.accounts.set(player.accountKey, this.toSave(player));
        if (this.online.get(player.accountKey) === id) this.online.delete(player.accountKey);
        this.saveNow(); // persist this character's progress immediately
      }
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
    if (msg.t !== "join" && !player.loggedIn) return; // ignore until logged in
    switch (msg.t) {
      case "join":
        this.onJoin(player, msg.name, msg.password ?? "", msg.skin);
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
      case "equip":
        this.onEquip(player, msg.slot);
        break;
      case "unequip":
        this.onUnequip(player, msg.slot);
        break;
      case "gridPlace":
        this.onGridPlace(player, msg.cell, msg.item);
        break;
      case "gridTake":
        this.onGridTake(player, msg.cell);
        break;
      case "gridCraft":
        this.onGridCraft(player);
        break;
      case "gridClear":
        this.returnGrid(player);
        this.sendGrid(player);
        this.send(player, { t: "inventory", inventory: player.inventory });
        break;
    }
  }

  private onJoin(player: Player, name: string, password: string, skin: Skin | undefined): void {
    if (player.loggedIn) return;
    const display = (name || "Adventurer").trim().slice(0, 16) || "Adventurer";
    const key = display.toLowerCase();

    if (this.online.has(key)) {
      this.send(player, { t: "loginError", reason: "That character is already logged in." });
      player.socket.close();
      return;
    }

    const existing = this.accounts.get(key);
    if (existing) {
      if (!verifyPassword(password, existing.salt, existing.passHash)) {
        this.send(player, { t: "loginError", reason: "Wrong password for that name." });
        player.socket.close();
        return;
      }
      this.applySave(player, existing);
    } else {
      // New character: keep the starting defaults, set its (optional) password.
      const pw = hashPassword(password);
      player.salt = pw?.salt ?? null;
      player.passHash = pw?.hash ?? null;
      player.name = display;
    }

    // A skin sent at login overrides the saved one (lets you re-customise).
    player.skin = sanitizeSkin(skin ?? (existing ? player.skin : undefined), display);

    player.accountKey = key;
    player.loggedIn = true;
    this.online.set(key, player.id);
    this.accounts.set(key, this.toSave(player));

    this.send(player, {
      t: "welcome",
      id: player.id,
      seed: this.world.seed,
      spawn: player.pos,
      players: [...this.players.values()]
        .filter((p) => p.id !== player.id && p.loggedIn)
        .map((p) => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw, skin: p.skin, gear: gearFromEquipment(p.equipment) })),
      inventory: player.inventory,
      skills: player.skills,
      hp: player.hp,
      maxHp: maxHitpoints(player.skills),
      equipment: player.equipment,
      bonuses: equipmentBonuses(player.equipment),
    });
    this.streamChunks(player);
    this.sendEntities(player);
    // Restore quest tracker state.
    for (const q of QUESTS) {
      if (player.questDone.has(q.id)) {
        this.send(player, { t: "quest", id: q.id, name: q.name, status: "complete", progress: q.killCount, goal: q.killCount });
      } else if (player.questActive.has(q.id)) {
        const p = player.questProgress[q.id] ?? 0;
        this.send(player, { t: "quest", id: q.id, name: q.name, status: "active", progress: p, goal: q.killCount });
      }
    }
    this.broadcast(
      { t: "playerJoined", player: { id: player.id, name: player.name, pos: player.pos, yaw: player.yaw, skin: player.skin, gear: gearFromEquipment(player.equipment) } },
      player.id,
    );
    console.log(`[minescape] ${player.name} ${existing ? "logged in" : "registered"} (${this.players.size} online)`);
  }

  // ---- Persistence helpers ----

  private toSave(player: Player): PlayerSave {
    return {
      name: player.name,
      salt: player.salt,
      passHash: player.passHash,
      skin: player.skin,
      equipment: player.equipment,
      skills: player.skills,
      inventory: player.inventory,
      bank: player.bank,
      hp: player.hp,
      pos: player.pos,
      yaw: player.yaw,
      quest: {
        active: [...player.questActive],
        progress: { ...player.questProgress },
        done: [...player.questDone],
      },
      lastSeen: Date.now(),
    };
  }

  private applySave(player: Player, s: PlayerSave): void {
    player.name = s.name;
    player.salt = s.salt;
    player.passHash = s.passHash;
    if (s.skin) player.skin = s.skin;
    if (s.equipment) player.equipment = { ...emptyEquipment(), ...s.equipment };
    // Merge skills so characters saved before a new skill existed still load.
    player.skills = { ...emptySkills(), ...s.skills };
    player.inventory = padSlots(s.inventory, player.inventory.length);
    player.bank = padSlots(s.bank, player.bank.length);
    player.hp = Math.max(1, Math.min(s.hp, maxHitpoints(player.skills)));
    player.pos = s.pos;
    player.yaw = s.yaw;
    player.questActive = new Set(s.quest?.active ?? []);
    player.questProgress = { ...(s.quest?.progress ?? {}) };
    player.questDone = new Set(s.quest?.done ?? []);
  }

  /** Sync online players into accounts and write the save. Safe to call often. */
  async saveNow(): Promise<void> {
    for (const player of this.players.values()) {
      if (player.loggedIn && player.accountKey) this.accounts.set(player.accountKey, this.toSave(player));
    }
    const data: SaveData = {
      version: SAVE_VERSION,
      seed: this.world.seed,
      accounts: Object.fromEntries(this.accounts),
      world: this.world.exportEdits(),
    };
    try {
      await this.storage.save(data);
    } catch (err) {
      console.error("[minescape] save failed:", err);
    }
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
      // Mining out rock (stone, mossy stone, runestone, crystal) trains Mining.
      if (def.mineXp) this.awardXp(player, SkillId.Mining, def.mineXp);
      // Breaking leaves sometimes yields a sapling you can replant.
      if (current === BlockType.Leaves && Math.random() < SAPLING_DROP_CHANCE && hasSpaceFor(player.inventory, "sapling")) {
        addItem(player.inventory, "sapling", 1);
        this.send(player, { t: "inventory", inventory: player.inventory });
        this.send(player, { t: "notice", text: "You find a sapling." });
      }
    } else {
      if (current !== BlockType.Air && current !== BlockType.Water) return;
      // Saplings can only take root on grass or dirt.
      if (block === BlockType.Sapling) {
        const below = this.world.getBlock(x, y - 1, z);
        if (below !== BlockType.Grass && below !== BlockType.Dirt) {
          this.send(player, { t: "notice", text: "Saplings need grass or dirt to grow." });
          return;
        }
      }
      const itemId = Object.values(ITEMS).find((i) => i.placeBlock === block)?.id;
      if (!itemId || !removeItem(player.inventory, itemId, 1)) return;
      this.send(player, { t: "inventory", inventory: player.inventory });
      this.applyEdit(x, y, z, block);
      if (block === BlockType.Sapling) {
        this.world.scheduleGrowth(x, y, z, GROW_TICKS, this.tick);
        this.send(player, { t: "notice", text: "You plant the sapling — it will grow into a tree." });
      }
    }
  }

  private applyEdit(x: number, y: number, z: number, block: BlockType): void {
    this.world.editBlock(x, y, z, block); // recorded for persistence
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

    const bonus = equipmentBonuses(player.equipment);
    const atk = levelForXp(player.skills[SkillId.Attack]) + bonus.attack;
    const str = levelForXp(player.skills[SkillId.Strength]) + bonus.strength;
    const hitChance = Math.max(0.3, Math.min(0.95, 0.62 + (atk - m.def.defence) * 0.05));
    const maxHit = 1 + Math.floor((str - 1) / 3);
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

  /** The next quest a giver should offer/track: first incomplete one whose
   *  prerequisite is met. Returns undefined when the chain is finished. */
  private currentQuest(player: Player, giverId: string): QuestDef | undefined {
    for (const q of questsByGiver(giverId)) {
      if (player.questDone.has(q.id)) continue;
      if (q.requires && !player.questDone.has(q.requires)) continue;
      return q;
    }
    return undefined;
  }

  private sendQuestDialogue(player: Player, npc: NpcEntity): void {
    const quest = this.currentQuest(player, "quest");
    if (!quest) {
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: "You've answered every call, champion. The realm is at peace because of you.",
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
      this.completeQuest(player, npc, quest);
    } else {
      const remaining = quest.killCount - progress;
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: quest.progressText.replace("{n}", String(remaining)),
        options: [{ id: "bye", label: "I'm on it" }],
      });
    }
  }

  private completeQuest(player: Player, npc: NpcEntity, quest: QuestDef): void {
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
      const quest = this.currentQuest(player, "quest");
      if (!quest) return;
      player.questActive.add(quest.id);
      player.questProgress[quest.id] = 0;
      this.send(player, { t: "quest", id: quest.id, name: quest.name, status: "active", progress: 0, goal: quest.killCount });
      this.send(player, {
        t: "dialogue", npc: npc.id, name: npc.def.name,
        text: quest.acceptText,
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

  // ---- Equipment ----

  private onEquip(player: Player, invSlot: number): void {
    const stack = player.inventory[invSlot];
    if (!stack) return;
    const def = ITEMS[stack.item];
    const eq = def?.equip;
    if (!eq) {
      this.send(player, { t: "notice", text: `You can't equip ${def?.name ?? "that"}.` });
      return;
    }
    if (eq.reqAttack && levelForXp(player.skills[SkillId.Attack]) < eq.reqAttack) {
      this.send(player, { t: "notice", text: `You need Attack level ${eq.reqAttack} to wield that.` });
      return;
    }
    if (eq.reqDefence && levelForXp(player.skills[SkillId.Defence]) < eq.reqDefence) {
      this.send(player, { t: "notice", text: `You need Defence level ${eq.reqDefence} to wear that.` });
      return;
    }
    const previous = player.equipment[eq.slot];
    // Take the item out of the pack (frees a slot for any swapped-out gear).
    removeItem(player.inventory, stack.item, 1);
    if (previous) addItem(player.inventory, previous, 1);
    player.equipment[eq.slot] = stack.item;
    this.afterEquipChange(player);
    this.send(player, { t: "notice", text: `You equip the ${def.name}.` });
  }

  private onUnequip(player: Player, slot: EquipSlot): void {
    const current = player.equipment[slot];
    if (!current) return;
    if (!hasSpaceFor(player.inventory, current)) {
      this.send(player, { t: "notice", text: "Your inventory is full." });
      return;
    }
    addItem(player.inventory, current, 1);
    player.equipment[slot] = null;
    this.afterEquipChange(player);
  }

  private afterEquipChange(player: Player): void {
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.send(player, { t: "equipment", equipment: player.equipment, bonuses: equipmentBonuses(player.equipment) });
    // Tell other clients about the worn-armor colors for avatar display.
    this.broadcast({ t: "playerGear", id: player.id, gear: gearFromEquipment(player.equipment) }, player.id);
  }

  // ---- Crafting grid ----

  private sendGrid(player: Player): void {
    const ids = player.craftGrid.map((c) => c?.item ?? null);
    const recipe = matchGrid(ids);
    const result = recipe ? { item: recipe.output.item, count: recipe.output.count } : null;
    this.send(player, { t: "grid", cells: player.craftGrid, result });
  }

  private onGridPlace(player: Player, cell: number, item: string): void {
    if (cell < 0 || cell >= GRID_SIZE) return;
    if (countItem(player.inventory, item) < 1) return;
    const existing = player.craftGrid[cell];
    if (existing && existing.item !== item) return; // cell holds a different item
    removeItem(player.inventory, item, 1);
    if (existing) existing.count += 1;
    else player.craftGrid[cell] = { item, count: 1 };
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.sendGrid(player);
  }

  private onGridTake(player: Player, cell: number): void {
    if (cell < 0 || cell >= GRID_SIZE) return;
    const c = player.craftGrid[cell];
    if (!c) return;
    addItem(player.inventory, c.item, c.count);
    player.craftGrid[cell] = null;
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.sendGrid(player);
  }

  private onGridCraft(player: Player): void {
    const recipe = matchGrid(player.craftGrid.map((c) => c?.item ?? null));
    if (!recipe) return;
    if (recipe.skill && recipe.levelReq && levelForXp(player.skills[recipe.skill]) < recipe.levelReq) {
      this.send(player, { t: "notice", text: `You need ${recipe.skill} level ${recipe.levelReq}.` });
      return;
    }
    if (!hasSpaceFor(player.inventory, recipe.output.item)) {
      this.send(player, { t: "notice", text: "Your inventory is full." });
      return;
    }
    // Consume one item from every occupied cell.
    for (let i = 0; i < GRID_SIZE; i++) {
      const c = player.craftGrid[i];
      if (!c) continue;
      c.count -= 1;
      if (c.count <= 0) player.craftGrid[i] = null;
    }
    addItem(player.inventory, recipe.output.item, recipe.output.count);
    if (recipe.skill && recipe.xp) this.awardXp(player, recipe.skill, recipe.xp);
    this.send(player, { t: "inventory", inventory: player.inventory });
    this.sendGrid(player);
    this.send(player, { t: "notice", text: `You craft ${recipe.output.count} ${ITEMS[recipe.output.item]?.name}.` });
  }

  private returnGrid(player: Player): void {
    for (let i = 0; i < GRID_SIZE; i++) {
      const c = player.craftGrid[i];
      if (c) addItem(player.inventory, c.item, c.count);
      player.craftGrid[i] = null;
    }
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
    // Planted saplings grow into full trees.
    for (const g of this.world.tickGrowth(this.tick)) {
      for (const e of this.world.growTreeAt(g.x, g.y, g.z)) {
        this.broadcast({ t: "worldEdit", x: e.x, y: e.y, z: e.z, block: e.block });
      }
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
        if (node.permanent) {
          this.applyEdit(x, y, z, BlockType.Air); // recorded edit: stays gone across reloads
          player.gathering = null;
        } else if (node.respawnTicks > 0) {
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
            const defLevel = levelForXp(target.skills[SkillId.Defence]) + equipmentBonuses(target.equipment).defence;
            const hitChance = Math.max(0.05, Math.min(0.9, 0.5 + (m.def.attack - defLevel) * 0.04));
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
    // Stay near the spawn (leash), keeping each lair's pack clustered.
    if (horizDist(m.pos, m.spawn) > m.leash) m.heading = Math.atan2(m.spawn.x - m.pos.x, m.spawn.z - m.pos.z);
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
