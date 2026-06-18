// Item catalogue. Items live in the player inventory and are produced by
// gathering skills, breaking blocks, or processing (e.g. cooking).

import { BlockType } from "./blocks";

export interface ItemDef {
  id: string;
  name: string;
  /** If placeable, the block it turns into when used on the world. */
  placeBlock?: BlockType;
  stackable: boolean;
  /** Hex color for the inventory icon swatch. */
  color: string;
}

export const ITEMS: Record<string, ItemDef> = {
  dirt: { id: "dirt", name: "Dirt", placeBlock: BlockType.Dirt, stackable: true, color: "#735234" },
  stone: { id: "stone", name: "Stone", placeBlock: BlockType.Stone, stackable: true, color: "#808085" },
  sand: { id: "sand", name: "Sand", placeBlock: BlockType.Sand, stackable: true, color: "#d4c287" },
  logs: { id: "logs", name: "Logs", placeBlock: BlockType.Log, stackable: true, color: "#6b4a29" },
  leaves: { id: "leaves", name: "Leaves", placeBlock: BlockType.Leaves, stackable: true, color: "#408033" },
  plank: { id: "plank", name: "Plank", placeBlock: BlockType.Plank, stackable: true, color: "#b38d54" },
  coal: { id: "coal", name: "Coal", stackable: true, color: "#3a3a40" },
  iron_ore: { id: "iron_ore", name: "Iron Ore", stackable: true, color: "#a67f6b" },
  gold_ore: { id: "gold_ore", name: "Gold Ore", stackable: true, color: "#c7a847" },
  raw_fish: { id: "raw_fish", name: "Raw Fish", stackable: true, color: "#6fa3b5" },
  cooked_fish: { id: "cooked_fish", name: "Cooked Fish", stackable: true, color: "#c98a4b" },
};

export interface ItemStack {
  item: string;
  count: number;
}

export const INVENTORY_SLOTS = 28; // RuneScape's iconic 28-slot backpack.
