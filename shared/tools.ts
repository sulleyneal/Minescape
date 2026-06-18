// Tool categories and the maths for how long breaking a block takes.
// Kept dependency-free so blocks.ts, items.ts, the server, and the client can
// all share one definition of "what can break what, and how fast".

export type ToolType = "pickaxe" | "axe" | "shovel" | "hand";

export const TIER_NAMES: Record<number, string> = {
  1: "Bronze",
  2: "Iron",
  3: "Crystal",
};

/** Higher tiers break faster (multiplies the base break time). */
export const TIER_SPEED: Record<number, number> = {
  1: 1.0,
  2: 0.6,
  3: 0.35,
};

/** Penalty for using bare hands / the wrong tool on a block that allows it. */
export const HAND_PENALTY = 2.5;

export interface ToolStats {
  type: ToolType;
  tier: number;
}

/**
 * Seconds to break a block with the given tool (or null for bare hands).
 * Returns Infinity when the block can't be broken that way (bedrock, or a
 * tool-required block without the matching tool).
 */
export function breakTime(
  hardness: number,
  blockTool: ToolType,
  requiresTool: boolean,
  tool: ToolStats | null,
): number {
  if (!isFinite(hardness)) return Infinity;
  const correct = tool != null && tool.type === blockTool;
  if (requiresTool && !correct) return Infinity;
  if (correct) return hardness * (TIER_SPEED[tool!.tier] ?? 1);
  return hardness * HAND_PENALTY;
}
