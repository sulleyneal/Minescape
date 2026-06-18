// Block definitions. Each voxel in the world is one of these ids.
// Colors are used directly as vertex colors by the client renderer, so the
// game needs zero texture assets to look readable.

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
}

export interface BlockDef {
  id: BlockType;
  name: string;
  /** Top-face color; sides are auto-darkened for cheap shading. */
  color: [number, number, number];
  /** Solid blocks collide with the player and occlude neighbour faces. */
  solid: boolean;
  /** Transparent blocks (water, leaves) still render neighbour faces. */
  transparent: boolean;
  /** If set, a player can break this block directly into the given item. */
  drops?: string;
}

export const BLOCKS: Record<BlockType, BlockDef> = {
  [BlockType.Air]: { id: BlockType.Air, name: "Air", color: [0, 0, 0], solid: false, transparent: true },
  [BlockType.Grass]: { id: BlockType.Grass, name: "Grass", color: [0.36, 0.62, 0.28], solid: true, transparent: false, drops: "dirt" },
  [BlockType.Dirt]: { id: BlockType.Dirt, name: "Dirt", color: [0.45, 0.32, 0.21], solid: true, transparent: false, drops: "dirt" },
  [BlockType.Stone]: { id: BlockType.Stone, name: "Stone", color: [0.5, 0.5, 0.52], solid: true, transparent: false, drops: "stone" },
  [BlockType.Sand]: { id: BlockType.Sand, name: "Sand", color: [0.83, 0.76, 0.53], solid: true, transparent: false, drops: "sand" },
  [BlockType.Water]: { id: BlockType.Water, name: "Water", color: [0.2, 0.4, 0.75], solid: false, transparent: true },
  [BlockType.Log]: { id: BlockType.Log, name: "Log", color: [0.42, 0.29, 0.16], solid: true, transparent: false, drops: "logs" },
  [BlockType.Leaves]: { id: BlockType.Leaves, name: "Leaves", color: [0.25, 0.5, 0.2], solid: true, transparent: true, drops: "leaves" },
  [BlockType.CoalOre]: { id: BlockType.CoalOre, name: "Coal Ore", color: [0.28, 0.28, 0.3], solid: true, transparent: false, drops: "coal" },
  [BlockType.IronOre]: { id: BlockType.IronOre, name: "Iron Ore", color: [0.65, 0.5, 0.42], solid: true, transparent: false, drops: "iron_ore" },
  [BlockType.GoldOre]: { id: BlockType.GoldOre, name: "Gold Ore", color: [0.78, 0.66, 0.28], solid: true, transparent: false, drops: "gold_ore" },
  [BlockType.Plank]: { id: BlockType.Plank, name: "Plank", color: [0.7, 0.55, 0.33], solid: true, transparent: false, drops: "plank" },
  [BlockType.Bedrock]: { id: BlockType.Bedrock, name: "Bedrock", color: [0.1, 0.1, 0.11], solid: true, transparent: false },
};

export function isSolid(id: BlockType): boolean {
  return BLOCKS[id]?.solid ?? false;
}

export function isOpaque(id: BlockType): boolean {
  const b = BLOCKS[id];
  return b ? b.solid && !b.transparent : false;
}
