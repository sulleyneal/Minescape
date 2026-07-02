// Item catalogue. Items live in the player inventory and are produced by
// gathering skills, breaking blocks, or crafting. Tools carry stats used by the
// break-time maths (see tools.ts).

import { BlockType } from "./blocks";
import type { EquipStats } from "./equipment";
import { ToolStats, ToolType } from "./tools";

export interface ItemDef {
  id: string;
  name: string;
  /** If placeable, the block it turns into when used on the world. */
  placeBlock?: BlockType;
  stackable: boolean;
  /** Hex color for the inventory icon swatch. */
  color: string;
  /** Glyph drawn on the inventory slot so items are identifiable at a glance. */
  icon?: string;
  /** Present on tools; drives what they can break and how fast. */
  tool?: ToolStats;
  /** Present on weapons/armor; equip slot + combat bonuses. */
  equip?: EquipStats;
  /** Shop base value in coins (for buying/selling). */
  value?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  // Materials / drops
  dirt: { id: "dirt", name: "Dirt", placeBlock: BlockType.Dirt, stackable: true, color: "#735234", icon: "🟫" },
  stone: { id: "stone", name: "Stone", placeBlock: BlockType.Stone, stackable: true, color: "#808085", icon: "🪨" },
  sand: { id: "sand", name: "Sand", placeBlock: BlockType.Sand, stackable: true, color: "#d4c287", icon: "🟨" },
  logs: { id: "logs", name: "Logs", placeBlock: BlockType.Log, stackable: true, color: "#6b4a29", icon: "🪵" },
  leaves: { id: "leaves", name: "Leaves", placeBlock: BlockType.Leaves, stackable: true, color: "#408033", icon: "🍃" },
  sapling: { id: "sapling", name: "Sapling", placeBlock: BlockType.Sapling, stackable: true, color: "#4f9140", icon: "🌱", value: 2 },
  plank: { id: "plank", name: "Plank", placeBlock: BlockType.Plank, stackable: true, color: "#b38d54", icon: "🟧" },
  stick: { id: "stick", name: "Stick", stackable: true, color: "#8a6a3a", icon: "🥢", value: 1 },
  flower: { id: "flower", name: "Aether Bloom", placeBlock: BlockType.Flower, stackable: true, color: "#a673e6", icon: "🌸", value: 2 },
  cactus: { id: "cactus", name: "Cactus", placeBlock: BlockType.Cactus, stackable: true, color: "#4c8c47", icon: "🌵", value: 2 },
  coal: { id: "coal", name: "Coal", stackable: true, color: "#3a3a40", icon: "⚫" },
  iron_ore: { id: "iron_ore", name: "Iron Ore", stackable: true, color: "#a67f6b", icon: "🟤" },
  gold_ore: { id: "gold_ore", name: "Gold Ore", stackable: true, color: "#c7a847", icon: "🟡" },
  rune_shard: { id: "rune_shard", name: "Rune Shard", stackable: true, color: "#7b6cff", icon: "✨" },
  crystal: { id: "crystal", name: "Aether Crystal", placeBlock: BlockType.Crystal, stackable: true, color: "#8fdcef", icon: "💎" },
  raw_fish: { id: "raw_fish", name: "Raw Fish", stackable: true, color: "#6fa3b5", icon: "🐟", value: 4 },
  cooked_fish: { id: "cooked_fish", name: "Cooked Fish", stackable: true, color: "#c98a4b", icon: "🍤", value: 8 },

  // Currency, combat drops, and smithing materials
  coins: { id: "coins", name: "Coins", stackable: true, color: "#e0bb45", icon: "🪙", value: 1 },
  bones: { id: "bones", name: "Bones", stackable: true, color: "#e8e4d0", icon: "🦴", value: 1 },
  iron_bar: { id: "iron_bar", name: "Iron Bar", stackable: true, color: "#b0b0b8", icon: "🔩", value: 20 },
  hide: { id: "hide", name: "Beast Hide", stackable: true, color: "#8a5a3a", icon: "🟫", value: 5 },

  // Weapons (equip to wield)
  bronze_sword: { id: "bronze_sword", name: "Bronze Sword", stackable: false, color: "#9a7b4f", icon: "🗡️", equip: { slot: "weapon", attack: 2, strength: 2, reqAttack: 1 }, value: 25 },
  iron_sword: { id: "iron_sword", name: "Iron Sword", stackable: false, color: "#c8c8d0", icon: "🗡️", equip: { slot: "weapon", attack: 5, strength: 5, reqAttack: 10 }, value: 80 },
  aether_sword: { id: "aether_sword", name: "Aether Blade", stackable: false, color: "#8fdcef", icon: "⚔️", equip: { slot: "weapon", attack: 12, strength: 12, reqAttack: 30 }, value: 400 },

  // Armor (equip for Defence). Tiers: Bronze / Iron / Aether.
  bronze_helm: { id: "bronze_helm", name: "Bronze Helm", stackable: false, color: "#9a7b4f", icon: "⛑️", equip: { slot: "helmet", defence: 2, reqDefence: 1 }, value: 20 },
  bronze_body: { id: "bronze_body", name: "Bronze Platebody", stackable: false, color: "#9a7b4f", icon: "🦺", equip: { slot: "body", defence: 4, reqDefence: 1 }, value: 40 },
  bronze_legs: { id: "bronze_legs", name: "Bronze Platelegs", stackable: false, color: "#9a7b4f", icon: "👖", equip: { slot: "legs", defence: 3, reqDefence: 1 }, value: 30 },
  bronze_shield: { id: "bronze_shield", name: "Bronze Shield", stackable: false, color: "#9a7b4f", icon: "🛡️", equip: { slot: "shield", defence: 3, reqDefence: 1 }, value: 30 },
  iron_helm: { id: "iron_helm", name: "Iron Helm", stackable: false, color: "#c8c8d0", icon: "⛑️", equip: { slot: "helmet", defence: 5, reqDefence: 10 }, value: 70 },
  iron_body: { id: "iron_body", name: "Iron Platebody", stackable: false, color: "#c8c8d0", icon: "🦺", equip: { slot: "body", defence: 9, reqDefence: 10 }, value: 140 },
  iron_legs: { id: "iron_legs", name: "Iron Platelegs", stackable: false, color: "#c8c8d0", icon: "👖", equip: { slot: "legs", defence: 7, reqDefence: 10 }, value: 110 },
  iron_shield: { id: "iron_shield", name: "Iron Shield", stackable: false, color: "#c8c8d0", icon: "🛡️", equip: { slot: "shield", defence: 6, reqDefence: 10 }, value: 100 },
  aether_helm: { id: "aether_helm", name: "Aether Helm", stackable: false, color: "#8fdcef", icon: "⛑️", equip: { slot: "helmet", defence: 12, reqDefence: 30 }, value: 300 },
  aether_body: { id: "aether_body", name: "Aether Platebody", stackable: false, color: "#8fdcef", icon: "🦺", equip: { slot: "body", defence: 20, reqDefence: 30 }, value: 600 },
  aether_legs: { id: "aether_legs", name: "Aether Platelegs", stackable: false, color: "#8fdcef", icon: "👖", equip: { slot: "legs", defence: 16, reqDefence: 30 }, value: 500 },
  aether_shield: { id: "aether_shield", name: "Aether Shield", stackable: false, color: "#8fdcef", icon: "🛡️", equip: { slot: "shield", defence: 14, reqDefence: 30 }, value: 450 },

  // Tools (tier 1 Bronze, 2 Iron, 3 Crystal)
  bronze_pickaxe: { id: "bronze_pickaxe", name: "Bronze Pickaxe", stackable: false, color: "#9a7b4f", icon: "⛏️", tool: { type: "pickaxe", tier: 1 } },
  bronze_axe: { id: "bronze_axe", name: "Bronze Hatchet", stackable: false, color: "#9a7b4f", icon: "🪓", tool: { type: "axe", tier: 1 } },
  bronze_shovel: { id: "bronze_shovel", name: "Bronze Shovel", stackable: false, color: "#9a7b4f", icon: "🥄", tool: { type: "shovel", tier: 1 } },
  iron_pickaxe: { id: "iron_pickaxe", name: "Iron Pickaxe", stackable: false, color: "#c8c8d0", icon: "⛏️", tool: { type: "pickaxe", tier: 2 } },
  iron_axe: { id: "iron_axe", name: "Iron Hatchet", stackable: false, color: "#c8c8d0", icon: "🪓", tool: { type: "axe", tier: 2 } },
  crystal_pickaxe: { id: "crystal_pickaxe", name: "Aether Pickaxe", stackable: false, color: "#8fdcef", icon: "⛏️", tool: { type: "pickaxe", tier: 3 } },
  crystal_axe: { id: "crystal_axe", name: "Aether Hatchet", stackable: false, color: "#8fdcef", icon: "🪓", tool: { type: "axe", tier: 3 } },
};

export interface ItemStack {
  item: string;
  count: number;
}

export const INVENTORY_SLOTS = 28; // RuneScape's iconic 28-slot backpack.

/** Best (highest-tier) tool of a given type held in an inventory, or null. */
export function bestTool(inventory: (ItemStack | null)[], type: ToolType): ToolStats | null {
  let best: ToolStats | null = null;
  for (const slot of inventory) {
    if (!slot) continue;
    const t = ITEMS[slot.item]?.tool;
    if (t && t.type === type && (!best || t.tier > best.tier)) best = t;
  }
  return best;
}
