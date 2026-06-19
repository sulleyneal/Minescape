// Definitions for living things in the world (monsters and NPCs) plus the shop
// and quest data they expose. Shared so the client can render names/colors and
// the server can simulate combat, loot, trade, and quests from one source.

import { Biome } from "./biomes";
import { SkillId } from "./skills";

export interface LootDrop {
  item: string;
  min: number;
  max: number;
  /** Chance 0..1 of dropping at all (coins/bones are usually 1). */
  chance: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  attack: number;
  defence: number;
  maxHit: number;
  /** Ticks between the monster's attacks. */
  attackTicks: number;
  /** Attacks the player on sight within aggroRange. */
  aggressive: boolean;
  aggroRange: number;
  /** Hex color + size for the client avatar. */
  color: string;
  scale: number;
  loot: LootDrop[];
  /** Ticks before a slain monster respawns. */
  respawnTicks: number;
  biomes: Biome[];
}

export const MONSTERS: Record<string, MonsterDef> = {
  goblin: {
    id: "goblin", name: "Goblin", level: 2, maxHp: 5, attack: 1, defence: 1, maxHit: 1,
    attackTicks: 4, aggressive: false, aggroRange: 4, color: "#5a7d3a", scale: 0.85, respawnTicks: 20,
    biomes: [Biome.Plains, Biome.Forest],
    loot: [
      { item: "bones", min: 1, max: 1, chance: 1 },
      { item: "coins", min: 1, max: 8, chance: 0.9 },
    ],
  },
  wolf: {
    id: "wolf", name: "Grey Wolf", level: 6, maxHp: 10, attack: 4, defence: 2, maxHit: 2,
    attackTicks: 3, aggressive: true, aggroRange: 6, color: "#9aa0a8", scale: 0.9, respawnTicks: 25,
    biomes: [Biome.Tundra, Biome.Forest],
    loot: [
      { item: "bones", min: 1, max: 1, chance: 1 },
      { item: "hide", min: 1, max: 1, chance: 0.7 },
      { item: "coins", min: 2, max: 12, chance: 0.8 },
    ],
  },
  scorpion: {
    id: "scorpion", name: "Sand Scorpion", level: 8, maxHp: 12, attack: 5, defence: 4, maxHit: 2,
    attackTicks: 4, aggressive: true, aggroRange: 5, color: "#b5803a", scale: 0.8, respawnTicks: 25,
    biomes: [Biome.Desert],
    loot: [
      { item: "bones", min: 1, max: 1, chance: 1 },
      { item: "coins", min: 5, max: 20, chance: 0.9 },
    ],
  },
  skeleton: {
    id: "skeleton", name: "Skeleton", level: 14, maxHp: 18, attack: 8, defence: 6, maxHit: 3,
    attackTicks: 4, aggressive: true, aggroRange: 6, color: "#dcd8c8", scale: 1.0, respawnTicks: 30,
    biomes: [Biome.Mountains],
    loot: [
      { item: "bones", min: 1, max: 1, chance: 1 },
      { item: "coins", min: 10, max: 40, chance: 0.95 },
      { item: "iron_bar", min: 1, max: 1, chance: 0.15 },
    ],
  },
};

export type NpcRole = "banker" | "shop" | "quest";

export interface NpcDef {
  id: string;
  name: string;
  role: NpcRole;
  color: string;
  /** Fixed spawn offset from the world origin town. */
  x: number;
  z: number;
  greeting: string;
}

export const NPCS: NpcDef[] = [
  { id: "banker", name: "Gilda the Banker", role: "banker", color: "#3a6ea5", x: 5, z: 4,
    greeting: "Welcome to the Bank of Minescape. Shall I open your vault?" },
  { id: "shop", name: "Trader Bram", role: "shop", color: "#a5673a", x: -5, z: 4,
    greeting: "Finest wares this side of the realm! Care to trade?" },
  { id: "quest", name: "Captain Rovan", role: "quest", color: "#7a3a8a", x: 0, z: -6,
    greeting: "You there — you look capable. The goblins have grown bold..." },
];

export interface ShopEntry {
  item: string;
  price: number;
  /** How many the shop stocks (informational). */
  stock: number;
}

export const SHOP: { name: string; entries: ShopEntry[] } = {
  name: "Bram's General Store",
  entries: [
    { item: "bronze_sword", price: 25, stock: 10 },
    { item: "bronze_helm", price: 20, stock: 10 },
    { item: "bronze_body", price: 40, stock: 10 },
    { item: "bronze_legs", price: 30, stock: 10 },
    { item: "bronze_shield", price: 30, stock: 10 },
    { item: "bronze_pickaxe", price: 20, stock: 10 },
    { item: "bronze_axe", price: 20, stock: 10 },
    { item: "cooked_fish", price: 10, stock: 50 },
    { item: "plank", price: 3, stock: 100 },
  ],
};

export interface QuestDef {
  id: string;
  name: string;
  giver: string; // npc id
  killMonster: string;
  killCount: number;
  rewardCoins: number;
  rewardXp: { skill: SkillId; amount: number };
  rewardItem?: string;
  offerText: string;
  progressText: string;
  completeText: string;
}

export const QUESTS: QuestDef[] = [
  {
    id: "goblin_cull",
    name: "The Goblin Menace",
    giver: "quest",
    killMonster: "goblin",
    killCount: 6,
    rewardCoins: 150,
    rewardXp: { skill: SkillId.Attack, amount: 500 },
    rewardItem: "iron_sword",
    offerText: "Slay 6 goblins in the plains and I'll reward you well. Will you help?",
    progressText: "The goblins still trouble us. Return when {n} more lie defeated.",
    completeText: "You've done it! Take this blade and coin, hero. You've earned it.",
  },
];

export function questByGiver(npcId: string): QuestDef | undefined {
  return QUESTS.find((q) => q.giver === npcId);
}
