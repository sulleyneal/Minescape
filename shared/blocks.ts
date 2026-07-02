// Block definitions. Each voxel in the world is one of these ids.
// Base colors are still here (used as a fallback / inventory tint), but the
// client now renders blocks with procedurally generated textures + lighting.

import { ToolType } from "./tools";

export enum BlockType {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  Log = 6,
  Leaves = 7,
  CoalOre = 8,
  IronOre = 9,
  GoldOre = 10,
  Plank = 11,
  Bedrock = 12,
  // Mystical additions:
  MossStone = 13,
  Runestone = 14,
  Crystal = 15,
  // Biome surfaces:
  Snow = 16,
  // Decorations:
  TallGrass = 17,
  Flower = 18,
  DeadBush = 19,
  Cactus = 20,
}

export interface BlockDef {
  id: BlockType;
  name: string;
  /** Base tint; sides are auto-darkened by lighting. */
  color: [number, number, number];
  solid: boolean;
  transparent: boolean;
  /** If set, breaking this block yields the given item. */
  drops?: string;
  /** Seconds to break with the correct tier-1 tool (Infinity = unbreakable). */
  hardness: number;
  /** Which tool is effective on this block. */
  tool: ToolType;
  /** If true, the block cannot be broken without the matching tool. */
  requiresTool: boolean;
  /** Renderer hint: block emits a magical glow (crystals, runes). */
  glow?: boolean;
  /** Renderer hint: draw as two crossed quads (plants) instead of a cube. */
  cross?: boolean;
}

export const BLOCKS: Record<BlockType, BlockDef> = {
  [BlockType.Air]: { id: BlockType.Air, name: "Air", color: [0, 0, 0], solid: false, transparent: true, hardness: 0, tool: "hand", requiresTool: false },
  [BlockType.Grass]: { id: BlockType.Grass, name: "Grass", color: [0.36, 0.62, 0.28], solid: true, transparent: false, drops: "dirt", hardness: 0.8, tool: "shovel", requiresTool: false },
  [BlockType.Dirt]: { id: BlockType.Dirt, name: "Dirt", color: [0.45, 0.32, 0.21], solid: true, transparent: false, drops: "dirt", hardness: 0.8, tool: "shovel", requiresTool: false },
  [BlockType.Stone]: { id: BlockType.Stone, name: "Stone", color: [0.5, 0.5, 0.52], solid: true, transparent: false, drops: "stone", hardness: 2.0, tool: "pickaxe", requiresTool: true },
  [BlockType.Sand]: { id: BlockType.Sand, name: "Sand", color: [0.83, 0.76, 0.53], solid: true, transparent: false, drops: "sand", hardness: 0.6, tool: "shovel", requiresTool: false },
  [BlockType.Water]: { id: BlockType.Water, name: "Water", color: [0.2, 0.4, 0.75], solid: false, transparent: true, hardness: 0, tool: "hand", requiresTool: false },
  [BlockType.Log]: { id: BlockType.Log, name: "Log", color: [0.42, 0.29, 0.16], solid: true, transparent: false, drops: "logs", hardness: 1.6, tool: "axe", requiresTool: true },
  [BlockType.Leaves]: { id: BlockType.Leaves, name: "Leaves", color: [0.25, 0.5, 0.2], solid: true, transparent: false, drops: "leaves", hardness: 0.3, tool: "axe", requiresTool: false },
  [BlockType.CoalOre]: { id: BlockType.CoalOre, name: "Coal Ore", color: [0.28, 0.28, 0.3], solid: true, transparent: false, drops: "coal", hardness: 2.4, tool: "pickaxe", requiresTool: true },
  [BlockType.IronOre]: { id: BlockType.IronOre, name: "Iron Ore", color: [0.65, 0.5, 0.42], solid: true, transparent: false, drops: "iron_ore", hardness: 2.6, tool: "pickaxe", requiresTool: true },
  [BlockType.GoldOre]: { id: BlockType.GoldOre, name: "Gold Ore", color: [0.78, 0.66, 0.28], solid: true, transparent: false, drops: "gold_ore", hardness: 3.0, tool: "pickaxe", requiresTool: true },
  [BlockType.Plank]: { id: BlockType.Plank, name: "Plank", color: [0.7, 0.55, 0.33], solid: true, transparent: false, drops: "plank", hardness: 1.2, tool: "axe", requiresTool: false },
  [BlockType.Bedrock]: { id: BlockType.Bedrock, name: "Bedrock", color: [0.1, 0.1, 0.11], solid: true, transparent: false, hardness: Infinity, tool: "pickaxe", requiresTool: true },
  [BlockType.MossStone]: { id: BlockType.MossStone, name: "Mossy Stone", color: [0.38, 0.48, 0.38], solid: true, transparent: false, drops: "stone", hardness: 2.2, tool: "pickaxe", requiresTool: true },
  [BlockType.Runestone]: { id: BlockType.Runestone, name: "Runestone", color: [0.26, 0.24, 0.4], solid: true, transparent: false, drops: "rune_shard", hardness: 3.2, tool: "pickaxe", requiresTool: true, glow: true },
  [BlockType.Crystal]: { id: BlockType.Crystal, name: "Aether Crystal", color: [0.55, 0.85, 0.95], solid: true, transparent: false, drops: "crystal", hardness: 2.8, tool: "pickaxe", requiresTool: true, glow: true },
  [BlockType.Snow]: { id: BlockType.Snow, name: "Snow", color: [0.92, 0.95, 1.0], solid: true, transparent: false, drops: "dirt", hardness: 0.5, tool: "shovel", requiresTool: false },
  [BlockType.TallGrass]: { id: BlockType.TallGrass, name: "Tall Grass", color: [0.42, 0.65, 0.32], solid: false, transparent: true, hardness: 0.05, tool: "hand", requiresTool: false, cross: true },
  [BlockType.Flower]: { id: BlockType.Flower, name: "Aether Bloom", color: [0.65, 0.45, 0.9], solid: false, transparent: true, drops: "flower", hardness: 0.05, tool: "hand", requiresTool: false, cross: true },
  [BlockType.DeadBush]: { id: BlockType.DeadBush, name: "Dead Bush", color: [0.55, 0.4, 0.25], solid: false, transparent: true, drops: "stick", hardness: 0.05, tool: "hand", requiresTool: false, cross: true },
  [BlockType.Cactus]: { id: BlockType.Cactus, name: "Cactus", color: [0.3, 0.55, 0.28], solid: true, transparent: false, drops: "cactus", hardness: 0.7, tool: "hand", requiresTool: false },
};

export function isSolid(id: BlockType): boolean {
  return BLOCKS[id]?.solid ?? false;
}

export function isOpaque(id: BlockType): boolean {
  const b = BLOCKS[id];
  return b ? b.solid && !b.transparent : false;
}
