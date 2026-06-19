// Biome identifiers, shared by world generation (server) and content/UI tinting.

export enum Biome {
  Plains = "plains",
  Forest = "forest",
  Desert = "desert",
  Tundra = "tundra",
  Mountains = "mountains",
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Plains]: "Plains",
  [Biome.Forest]: "Forest",
  [Biome.Desert]: "Desert",
  [Biome.Tundra]: "Tundra",
  [Biome.Mountains]: "Mountains",
};
