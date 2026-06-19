// Gathering and crafting rules — the heart of the RuneScape progression loop.
// A "gather" action targets a block; if it matches a node here the player
// trains the listed skill, receives an item, and (for ore/trees) the node is
// temporarily depleted then respawns, exactly like RuneScape resource nodes.

import { BlockType } from "./blocks";
import { SkillId } from "./skills";
import { ToolType } from "./tools";

export interface GatherNode {
  /** Block you click to gather from. */
  block: BlockType;
  skill: SkillId;
  /** Minimum level to attempt. */
  levelReq: number;
  xp: number;
  /** Item id rewarded. */
  yields: string;
  /** Block the node becomes while depleted (Air for trees, Stone for ore). */
  depletedBlock: BlockType;
  /** Ticks before the node respawns to its original block. */
  respawnTicks: number;
  /** Base success chance per tick at the level requirement (0..1). */
  baseChance: number;
  /** Tool needed to gather (axe to chop, pickaxe to mine; "hand" = none). */
  tool: ToolType;
  /** If true, the block is removed for good when gathered (no respawn) — used
   *  for trees so a chopped tree stays chopped, Minecraft-style. */
  permanent?: boolean;
}

export const GATHER_NODES: GatherNode[] = [
  {
    block: BlockType.Log,
    skill: SkillId.Woodcutting,
    levelReq: 1,
    xp: 25,
    yields: "logs",
    depletedBlock: BlockType.Air,
    respawnTicks: 0,
    baseChance: 0.35,
    tool: "axe",
    permanent: true, // chopped logs are gone for good (Minecraft-style)
  },
  {
    block: BlockType.MossStone,
    skill: SkillId.Mining,
    levelReq: 1,
    xp: 30,
    yields: "stone",
    depletedBlock: BlockType.Stone, // becomes plain rock, then the moss grows back
    respawnTicks: 15,
    baseChance: 0.45,
    tool: "pickaxe",
  },
  {
    block: BlockType.CoalOre,
    skill: SkillId.Mining,
    levelReq: 1,
    xp: 50,
    yields: "coal",
    depletedBlock: BlockType.Stone,
    respawnTicks: 8,
    baseChance: 0.3,
    tool: "pickaxe",
  },
  {
    block: BlockType.IronOre,
    skill: SkillId.Mining,
    levelReq: 10,
    xp: 35,
    yields: "iron_ore",
    depletedBlock: BlockType.Stone,
    respawnTicks: 8,
    baseChance: 0.4,
    tool: "pickaxe",
  },
  {
    block: BlockType.GoldOre,
    skill: SkillId.Mining,
    levelReq: 30,
    xp: 65,
    yields: "gold_ore",
    depletedBlock: BlockType.Stone,
    respawnTicks: 12,
    baseChance: 0.25,
    tool: "pickaxe",
  },
  {
    block: BlockType.Water,
    skill: SkillId.Fishing,
    levelReq: 1,
    xp: 30,
    yields: "raw_fish",
    depletedBlock: BlockType.Water, // water never depletes
    respawnTicks: 0,
    baseChance: 0.3,
    tool: "hand",
  },
];

export function nodeForBlock(block: BlockType): GatherNode | undefined {
  return GATHER_NODES.find((n) => n.block === block);
}

// ---- Crafting / processing recipes ----

export interface Recipe {
  id: string;
  name: string;
  /** Required input items and counts. */
  inputs: { item: string; count: number }[];
  output: { item: string; count: number };
  skill?: SkillId;
  levelReq?: number;
  xp?: number;
}

export const RECIPES: Recipe[] = [
  {
    id: "planks",
    name: "Logs → Planks",
    inputs: [{ item: "logs", count: 1 }],
    output: { item: "plank", count: 4 },
  },
  {
    id: "cook_fish",
    name: "Cook Raw Fish",
    inputs: [{ item: "raw_fish", count: 1 }],
    output: { item: "cooked_fish", count: 1 },
    skill: SkillId.Cooking,
    levelReq: 1,
    xp: 30,
  },
  // Tool progression: smelt ore into better tools, then attune with crystals.
  {
    id: "iron_pickaxe",
    name: "Forge Iron Pickaxe",
    inputs: [{ item: "iron_ore", count: 2 }, { item: "plank", count: 1 }],
    output: { item: "iron_pickaxe", count: 1 },
  },
  {
    id: "iron_axe",
    name: "Forge Iron Hatchet",
    inputs: [{ item: "iron_ore", count: 2 }, { item: "plank", count: 1 }],
    output: { item: "iron_axe", count: 1 },
  },
  {
    id: "crystal_pickaxe",
    name: "Attune Aether Pickaxe",
    inputs: [{ item: "crystal", count: 2 }, { item: "iron_pickaxe", count: 1 }],
    output: { item: "crystal_pickaxe", count: 1 },
  },
  {
    id: "crystal_axe",
    name: "Attune Aether Hatchet",
    inputs: [{ item: "crystal", count: 2 }, { item: "iron_axe", count: 1 }],
    output: { item: "crystal_axe", count: 1 },
  },
  // Smithing: smelt ore into bars, then forge bars into gear.
  {
    id: "smelt_iron",
    name: "Smelt Iron Bar",
    inputs: [{ item: "iron_ore", count: 1 }, { item: "coal", count: 1 }],
    output: { item: "iron_bar", count: 1 },
    skill: SkillId.Smithing,
    levelReq: 1,
    xp: 20,
  },
  {
    id: "smith_iron_sword",
    name: "Forge Iron Sword",
    inputs: [{ item: "iron_bar", count: 2 }],
    output: { item: "iron_sword", count: 1 },
    skill: SkillId.Smithing,
    levelReq: 5,
    xp: 50,
  },
  {
    id: "smith_aether_sword",
    name: "Attune Aether Blade",
    inputs: [{ item: "iron_sword", count: 1 }, { item: "crystal", count: 3 }],
    output: { item: "aether_sword", count: 1 },
    skill: SkillId.Smithing,
    levelReq: 20,
    xp: 200,
  },
  // Iron armor from bars.
  { id: "smith_iron_helm", name: "Forge Iron Helm", inputs: [{ item: "iron_bar", count: 2 }], output: { item: "iron_helm", count: 1 }, skill: SkillId.Smithing, levelReq: 5, xp: 40 },
  { id: "smith_iron_shield", name: "Forge Iron Shield", inputs: [{ item: "iron_bar", count: 3 }], output: { item: "iron_shield", count: 1 }, skill: SkillId.Smithing, levelReq: 7, xp: 60 },
  { id: "smith_iron_legs", name: "Forge Iron Platelegs", inputs: [{ item: "iron_bar", count: 3 }], output: { item: "iron_legs", count: 1 }, skill: SkillId.Smithing, levelReq: 9, xp: 70 },
  { id: "smith_iron_body", name: "Forge Iron Platebody", inputs: [{ item: "iron_bar", count: 5 }], output: { item: "iron_body", count: 1 }, skill: SkillId.Smithing, levelReq: 12, xp: 100 },
  // Aether armor: attune iron pieces with crystals.
  { id: "smith_aether_helm", name: "Attune Aether Helm", inputs: [{ item: "iron_helm", count: 1 }, { item: "crystal", count: 2 }], output: { item: "aether_helm", count: 1 }, skill: SkillId.Smithing, levelReq: 22, xp: 150 },
  { id: "smith_aether_shield", name: "Attune Aether Shield", inputs: [{ item: "iron_shield", count: 1 }, { item: "crystal", count: 2 }], output: { item: "aether_shield", count: 1 }, skill: SkillId.Smithing, levelReq: 24, xp: 170 },
  { id: "smith_aether_legs", name: "Attune Aether Platelegs", inputs: [{ item: "iron_legs", count: 1 }, { item: "crystal", count: 3 }], output: { item: "aether_legs", count: 1 }, skill: SkillId.Smithing, levelReq: 26, xp: 220 },
  { id: "smith_aether_body", name: "Attune Aether Platebody", inputs: [{ item: "iron_body", count: 1 }, { item: "crystal", count: 4 }], output: { item: "aether_body", count: 1 }, skill: SkillId.Smithing, levelReq: 28, xp: 300 },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
