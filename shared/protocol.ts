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
}

// ---- Client -> Server ----

export interface JoinMsg {
  t: "join";
  name: string;
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

export type ClientMessage = JoinMsg | MoveMsg | BlockEditMsg | GatherMsg | CraftMsg | ChatMsg;

// ---- Server -> Client ----

export interface WelcomeMsg {
  t: "welcome";
  id: string;
  seed: number;
  spawn: Vec3;
  players: PlayerState[];
  inventory: (ItemStack | null)[];
  skills: Skills;
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
  | NoticeMsg;
