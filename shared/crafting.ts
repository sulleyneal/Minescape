// Minecraft-style grid crafting: a 3x3 grid of items (each cell holds one item
// type) matched against shaped or shapeless recipes. Shared so the client can
// preview the result and the server can authoritatively craft it.

import { SkillId } from "./skills";

export const GRID_W = 3;
export const GRID_SIZE = GRID_W * GRID_W; // 9 cells, row-major

export interface GridRecipe {
  id: string;
  /** Shaped: trimmed pattern rows of item ids (null = empty). */
  pattern?: (string | null)[][];
  /** Shapeless: required items (each entry = one occupied cell). */
  shapeless?: string[];
  output: { item: string; count: number };
  skill?: SkillId;
  levelReq?: number;
  xp?: number;
}

const B = "iron_bar";
const S = "stick";

export const GRID_RECIPES: GridRecipe[] = [
  // --- Shapeless basics ---
  { id: "planks", shapeless: ["logs"], output: { item: "plank", count: 4 } },
  { id: "sticks", shapeless: ["plank", "plank"], output: { item: "stick", count: 4 } },
  { id: "cook_fish", shapeless: ["raw_fish"], output: { item: "cooked_fish", count: 1 }, skill: SkillId.Cooking, levelReq: 1, xp: 30 },
  { id: "smelt_iron", shapeless: ["iron_ore", "coal"], output: { item: "iron_bar", count: 1 }, skill: SkillId.Smithing, levelReq: 1, xp: 20 },

  // --- Shaped iron gear (classic Minecraft tool/armor shapes) ---
  { id: "iron_sword", pattern: [[B], [B], [S]], output: { item: "iron_sword", count: 1 }, skill: SkillId.Smithing, levelReq: 5, xp: 50 },
  { id: "iron_pickaxe", pattern: [[B, B, B], [null, S, null], [null, S, null]], output: { item: "iron_pickaxe", count: 1 }, skill: SkillId.Smithing, levelReq: 8, xp: 70 },
  { id: "iron_axe", pattern: [[B, B], [B, S], [null, S]], output: { item: "iron_axe", count: 1 }, skill: SkillId.Smithing, levelReq: 8, xp: 70 },
  { id: "iron_helm", pattern: [[B, B, B], [B, null, B]], output: { item: "iron_helm", count: 1 }, skill: SkillId.Smithing, levelReq: 5, xp: 40 },
  { id: "iron_body", pattern: [[B, null, B], [B, B, B], [B, B, B]], output: { item: "iron_body", count: 1 }, skill: SkillId.Smithing, levelReq: 12, xp: 100 },
  { id: "iron_legs", pattern: [[B, B, B], [B, null, B], [B, null, B]], output: { item: "iron_legs", count: 1 }, skill: SkillId.Smithing, levelReq: 9, xp: 70 },
  { id: "iron_shield", pattern: [[B, B, B], [B, B, B], [null, B, null]], output: { item: "iron_shield", count: 1 }, skill: SkillId.Smithing, levelReq: 7, xp: 60 },

  // --- Shapeless aether upgrades (attune iron gear with crystals) ---
  { id: "crystal_pickaxe", shapeless: ["iron_pickaxe", "crystal", "crystal"], output: { item: "crystal_pickaxe", count: 1 }, skill: SkillId.Smithing, levelReq: 18, xp: 120 },
  { id: "crystal_axe", shapeless: ["iron_axe", "crystal", "crystal"], output: { item: "crystal_axe", count: 1 }, skill: SkillId.Smithing, levelReq: 18, xp: 120 },
  { id: "aether_sword", shapeless: ["iron_sword", "crystal", "crystal", "crystal"], output: { item: "aether_sword", count: 1 }, skill: SkillId.Smithing, levelReq: 20, xp: 200 },
  { id: "aether_helm", shapeless: ["iron_helm", "crystal", "crystal"], output: { item: "aether_helm", count: 1 }, skill: SkillId.Smithing, levelReq: 22, xp: 150 },
  { id: "aether_shield", shapeless: ["iron_shield", "crystal", "crystal"], output: { item: "aether_shield", count: 1 }, skill: SkillId.Smithing, levelReq: 24, xp: 170 },
  { id: "aether_legs", shapeless: ["iron_legs", "crystal", "crystal", "crystal"], output: { item: "aether_legs", count: 1 }, skill: SkillId.Smithing, levelReq: 26, xp: 220 },
  { id: "aether_body", shapeless: ["iron_body", "crystal", "crystal", "crystal", "crystal"], output: { item: "aether_body", count: 1 }, skill: SkillId.Smithing, levelReq: 28, xp: 300 },
];

// ---- matching ----

function trim(grid: (string | null)[][]): (string | null)[][] | null {
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[r][c]) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) return null; // empty
  const out: (string | null)[][] = [];
  for (let r = minR; r <= maxR; r++) out.push(grid[r].slice(minC, maxC + 1));
  return out;
}

function patternsEqual(a: (string | null)[][], b: (string | null)[][]): boolean {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[0].length; c++) {
      if ((a[r][c] ?? null) !== (b[r][c] ?? null)) return false;
    }
  }
  return true;
}

/** Find the recipe a grid (row-major item ids, null = empty) produces, or null. */
export function matchGrid(cells: (string | null)[]): GridRecipe | null {
  const grid: (string | null)[][] = [
    cells.slice(0, 3),
    cells.slice(3, 6),
    cells.slice(6, 9),
  ];
  const trimmed = trim(grid);
  if (!trimmed) return null;

  // Shaped recipes first (more specific).
  for (const r of GRID_RECIPES) {
    if (r.pattern && patternsEqual(trimmed, r.pattern)) return r;
  }
  // Shapeless: compare the multiset of occupied cells.
  const items = cells.filter((x): x is string => !!x).sort();
  for (const r of GRID_RECIPES) {
    if (!r.shapeless) continue;
    const need = [...r.shapeless].sort();
    if (need.length === items.length && need.every((v, i) => v === items[i])) return r;
  }
  return null;
}

export function gridRecipeById(id: string): GridRecipe | undefined {
  return GRID_RECIPES.find((r) => r.id === id);
}
