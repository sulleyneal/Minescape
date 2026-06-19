// The wire protocol. Every message is JSON: { t: <type>, ...payload }.
// Both client and server import these types so the contract stays in sync.

import { BlockType } from "./blocks";
import { ItemStack } from "./items";
import { Skills } from "./skills";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  name: string;
  pos: Vec3;
  yaw: number;
  skin: Skin;
}

// ---- Client -> Server ----

export interface JoinMsg {
  t: "join";
  name: string;
  /** Optional password protecting the character on this name. */
  password?: string;
  /** Chosen avatar appearance (hex colors). */
  skin?: Skin;
}

export interface Skin {
  /** Body/shirt color, hex like "#cc4444". */
  body: string;
  /** Skin tone for the head, hex. */
  head: string;
}

export interface MoveMsg {
  t: "move";
  pos: Vec3;
  yaw: number;
}

/** Place or break a single block. blockType=Air means break. */
export interface BlockEditMsg {
  t: "blockEdit";
  x: number;
  y: number;
  z: number;
  block: BlockType;
}

/** Skill gathering attempt against a block (chop tree, mine ore, fish water). */
export interface GatherMsg {
  t: "gather";
  x: number;
  y: number;
  z: number;
}

export interface CraftMsg {
  t: "craft";
  recipe: string;
}

export interface ChatMsg {
  t: "chat";
  text: string;
}

/** Begin attacking an entity (by id). */
export interface AttackMsg {
  t: "attack";
  id: string;
}

/** Talk to an NPC entity (by id), opening dialogue. */
export interface TalkMsg {
  t: "talk";
  id: string;
}

/** Choose a dialogue option. */
export interface DialogueChoiceMsg {
  t: "dialogueChoice";
  npc: string;
  option: string;
}

export interface BankActionMsg {
  t: "bankAction";
  action: "deposit" | "withdraw" | "close";
  /** Inventory slot (deposit) or item id (withdraw). */
  slot?: number;
  item?: string;
  count: number;
}

export interface ShopActionMsg {
  t: "shopAction";
  action: "buy" | "sell" | "close";
  item?: string;
  slot?: number;
  count: number;
}

export interface RespawnMsg {
  t: "respawn";
}

export type ClientMessage =
  | JoinMsg
  | MoveMsg
  | BlockEditMsg
  | GatherMsg
  | CraftMsg
  | ChatMsg
  | AttackMsg
  | TalkMsg
  | DialogueChoiceMsg
  | BankActionMsg
  | ShopActionMsg
  | RespawnMsg;

// ---- Server -> Client ----

export interface WelcomeMsg {
  t: "welcome";
  id: string;
  seed: number;
  spawn: Vec3;
  players: PlayerState[];
  inventory: (ItemStack | null)[];
  skills: Skills;
  hp: number;
  maxHp: number;
}

export interface ChunkMsg {
  t: "chunk";
  cx: number;
  cz: number;
  /** Base64-encoded Uint8Array of CHUNK_SIZE*CHUNK_SIZE*WORLD_HEIGHT block ids. */
  data: string;
}

export interface PlayerJoinedMsg {
  t: "playerJoined";
  player: PlayerState;
}

export interface PlayerLeftMsg {
  t: "playerLeft";
  id: string;
}

export interface PlayerMovedMsg {
  t: "playerMoved";
  id: string;
  pos: Vec3;
  yaw: number;
}

export interface WorldEditMsg {
  t: "worldEdit";
  x: number;
  y: number;
  z: number;
  block: BlockType;
}

export interface InventoryMsg {
  t: "inventory";
  inventory: (ItemStack | null)[];
}

export interface SkillMsg {
  t: "skill";
  skill: string;
  xp: number;
  /** True when this update crossed a level boundary, for client celebration. */
  levelUp: boolean;
  level: number;
}

export interface ChatBroadcastMsg {
  t: "chat";
  from: string;
  text: string;
}

/** Lightweight feed for "You get some logs." style action text. */
export interface NoticeMsg {
  t: "notice";
  text: string;
}

/** Login rejected (wrong password / already online). Client returns to the menu. */
export interface LoginErrorMsg {
  t: "loginError";
  reason: string;
}

// ---- Entities (monsters + NPCs) ----

export interface EntitySnapshot {
  id: string;
  kind: "monster" | "npc";
  type: string;
  name: string;
  pos: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  level?: number;
}

/** Full snapshot of the entities near a player (replaces the client's set). */
export interface EntitiesMsg {
  t: "entities";
  entities: EntitySnapshot[];
}

/** A damage number to float over a target ("" id = the local player). */
export interface HitSplatMsg {
  t: "hitsplat";
  id: string;
  dmg: number;
}

export interface HealthMsg {
  t: "health";
  hp: number;
  maxHp: number;
}

export interface DeathMsg {
  t: "death";
}

export interface RespawnedMsg {
  t: "respawned";
  spawn: Vec3;
  hp: number;
}

// ---- Social / economy UIs ----

export interface DialogueMsg {
  t: "dialogue";
  npc: string;
  name: string;
  text: string;
  options: { id: string; label: string }[];
}

export interface BankMsg {
  t: "bank";
  items: (ItemStack | null)[];
}

export interface ShopMsg {
  t: "shop";
  name: string;
  entries: { item: string; price: number }[];
}

export interface CloseUiMsg {
  t: "closeUi";
  ui: "bank" | "shop" | "dialogue";
}

export interface QuestMsg {
  t: "quest";
  id: string;
  name: string;
  status: "available" | "active" | "complete";
  progress: number;
  goal: number;
}

export type ServerMessage =
  | WelcomeMsg
  | ChunkMsg
  | PlayerJoinedMsg
  | PlayerLeftMsg
  | PlayerMovedMsg
  | WorldEditMsg
  | InventoryMsg
  | SkillMsg
  | ChatBroadcastMsg
  | NoticeMsg
  | EntitiesMsg
  | HitSplatMsg
  | HealthMsg
  | DeathMsg
  | RespawnedMsg
  | DialogueMsg
  | BankMsg
  | ShopMsg
  | CloseUiMsg
  | QuestMsg
  | LoginErrorMsg;
