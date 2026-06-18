// Item catalogue. Items live in the player inventory and are produced by
// gathering skills, breaking blocks, or crafting. Tools carry stats used by the
// break-time maths (see tools.ts).

import { BlockType } from "./blocks";
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
  raw_fish: { id: "raw_fish", name: "Raw Fish", stackable: true, color: "#6fa3b5", icon: "🐟" },
  cooked_fish: { id: "cooked_fish", name: "Cooked Fish", stackable: true, color: "#c98a4b", icon: "🍤" },

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
