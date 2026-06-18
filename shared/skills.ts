// Skills and the RuneScape-style experience curve.
// The XP table is the exact classic RuneScape formula, so leveling "feels"
// like the game the project is paying homage to.

export enum SkillId {
  Woodcutting = "woodcutting",
  Mining = "mining",
  Fishing = "fishing",
  Firemaking = "firemaking",
  Cooking = "cooking",
  Attack = "attack",
}

export const SKILL_ORDER: SkillId[] = [
  SkillId.Woodcutting,
  SkillId.Mining,
  SkillId.Fishing,
  SkillId.Firemaking,
  SkillId.Cooking,
  SkillId.Attack,
];

export const SKILL_NAMES: Record<SkillId, string> = {
  [SkillId.Woodcutting]: "Woodcutting",
  [SkillId.Mining]: "Mining",
  [SkillId.Fishing]: "Fishing",
  [SkillId.Firemaking]: "Firemaking",
  [SkillId.Cooking]: "Cooking",
  [SkillId.Attack]: "Attack",
};

export const MAX_LEVEL = 99;

// Cumulative XP required to *reach* each level. Index 1 => level 1 (0 xp).
// Formula: points(L) = floor(L-1 + 300 * 2^((L-1)/7)); xp(L) = floor(sum/4).
const XP_TABLE: number[] = (() => {
  const table: number[] = [0, 0]; // index 0 unused, level 1 = 0 xp
  let points = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table[level + 1] = Math.floor(points / 4);
  }
  return table;
})();

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= MAX_LEVEL) return XP_TABLE[MAX_LEVEL];
  return XP_TABLE[level];
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && XP_TABLE[level + 1] <= xp) level++;
  return level;
}

/** Fraction (0..1) of progress from current level toward the next. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return (xp - cur) / (next - cur);
}

export type Skills = Record<SkillId, number>; // skill -> total xp

export function emptySkills(): Skills {
  return {
    [SkillId.Woodcutting]: 0,
    [SkillId.Mining]: 0,
    [SkillId.Fishing]: 0,
    [SkillId.Firemaking]: 0,
    [SkillId.Cooking]: 0,
    [SkillId.Attack]: 0,
  };
}

/** Combat-style "total level" used as a simple overall progression number. */
export function totalLevel(skills: Skills): number {
  return SKILL_ORDER.reduce((sum, s) => sum + levelForXp(skills[s]), 0);
}
