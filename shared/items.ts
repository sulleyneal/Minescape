// Item catalogue. Items live in the player inventory and are produced by
// gathering skills, breaking blocks, or crafting. Tools carry stats used by the
// break-time maths (see tools.ts).

import { BlockType } from "./blocks";
import { ToolStats, ToolType } from "./tools";

export interface WeaponStats {
  attack: number;
  strength: number;
}

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
  /** Present on weapons; adds to combat accuracy/damage when carried. */
  weapon?: WeaponStats;
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
  plank: { id: "plank", name: "Plank", placeBlock: BlockType.Plank, stackable: true, color: "#b38d54", icon: "🟧" },
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

  // Weapons (carried = used; best one applies)
  bronze_sword: { id: "bronze_sword", name: "Bronze Sword", stackable: false, color: "#9a7b4f", icon: "🗡️", weapon: { attack: 2, strength: 2 }, value: 25 },
  iron_sword: { id: "iron_sword", name: "Iron Sword", stackable: false, color: "#c8c8d0", icon: "🗡️", weapon: { attack: 5, strength: 5 }, value: 80 },
  aether_sword: { id: "aether_sword", name: "Aether Blade", stackable: false, color: "#8fdcef", icon: "⚔️", weapon: { attack: 12, strength: 12 }, value: 400 },

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

/** Best weapon carried (highest combined bonus), for combat maths. Fists if none. */
export function bestWeapon(inventory: (ItemStack | null)[]): WeaponStats {
  let best: WeaponStats = { attack: 0, strength: 0 };
  for (const slot of inventory) {
    if (!slot) continue;
    const w = ITEMS[slot.item]?.weapon;
    if (w && w.attack + w.strength > best.attack + best.strength) best = w;
  }
  return best;
}
