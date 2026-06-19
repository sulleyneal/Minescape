// Living entities the server simulates: wandering monsters and town NPCs.
// Spawning places them on the terrain surface; AI/combat is driven by the
// game server's tick (it owns player state). Loot is rolled here.

import { MONSTERS, MonsterDef, NPCS, NpcDef } from "../shared/entities";
import { Vec3 } from "../shared/protocol";
import { World } from "./world";

export interface MonsterEntity {
  id: string;
  def: MonsterDef;
  pos: Vec3;
  yaw: number;
  hp: number;
  spawn: Vec3;
  /** How far the monster may wander from its spawn before being leashed back. */
  leash: number;
  alive: boolean;
  respawnAtTick: number;
  targetPlayerId: string | null;
  lastAttackTick: number;
  /** Current wander heading (radians) and how long to keep it. */
  heading: number;
  headingTicks: number;
}

/** A themed monster "dwelling": a cluster of one monster type you travel to. */
interface LairSpec {
  monster: string;
  /** How many separate lairs of this type to place in the world. */
  lairs: number;
  /** Pack size spawned around each lair anchor. */
  packMin: number;
  packMax: number;
  /** Distance band from the world origin to look for an anchor. */
  minDist: number;
  maxDist: number;
}

// Lairs sit further out the deadlier they are, so the world reads as a journey:
// goblin camps ring the town, the mountain crypt is a long trek away.
const LAIRS: LairSpec[] = [
  { monster: "goblin", lairs: 3, packMin: 5, packMax: 7, minDist: 18, maxDist: 55 },
  { monster: "wolf", lairs: 2, packMin: 4, packMax: 6, minDist: 40, maxDist: 80 },
  { monster: "scorpion", lairs: 2, packMin: 4, packMax: 6, minDist: 45, maxDist: 95 },
  { monster: "skeleton", lairs: 1, packMin: 4, packMax: 5, minDist: 60, maxDist: 110 },
];

const LAIR_RADIUS = 5; // pack spread around the anchor
const LEASH = 9; // how far a lair monster roams before being pulled back

/** Tiny deterministic PRNG so lairs land in the same spots for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NpcEntity {
  id: string;
  def: NpcDef;
  pos: Vec3;
  yaw: number;
}

export interface WorldEntities {
  monsters: Map<string, MonsterEntity>;
  npcs: Map<string, NpcEntity>;
}

/** Place an entity standing on the surface at (x,z). */
function surfacePos(world: World, x: number, z: number): Vec3 {
  return { x: x + 0.5, y: world.heightAt(Math.floor(x), Math.floor(z)) + 1, z: z + 0.5 };
}

/** Find a dry anchor in one of the monster's biomes within the lair's distance band. */
function findLairAnchor(world: World, def: MonsterDef, spec: LairSpec, rng: () => number): { x: number; z: number } | null {
  for (let attempt = 0; attempt < 240; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = spec.minDist + rng() * (spec.maxDist - spec.minDist);
    const x = Math.round(Math.cos(angle) * dist);
    const z = Math.round(Math.sin(angle) * dist);
    if (!def.biomes.includes(world.biomeAt(x, z))) continue;
    if (surfacePos(world, x, z).y <= 1) continue; // underwater / void
    return { x, z };
  }
  return null;
}

/** A dry standing position near an anchor, or null if it kept landing in water. */
function placeNear(world: World, anchor: { x: number; z: number }, radius: number, rng: () => number): Vec3 | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = anchor.x + Math.round((rng() * 2 - 1) * radius);
    const z = anchor.z + Math.round((rng() * 2 - 1) * radius);
    const pos = surfacePos(world, x, z);
    if (pos.y > 1) return pos;
  }
  return null;
}

export function spawnWorldEntities(world: World): WorldEntities {
  const monsters = new Map<string, MonsterEntity>();
  const npcs = new Map<string, NpcEntity>();

  // NPCs cluster in a "town" at the world origin.
  for (const def of NPCS) {
    npcs.set(def.id, {
      id: `npc_${def.id}`,
      def,
      pos: surfacePos(world, def.x, def.z),
      yaw: 0,
    });
  }

  // Spawn monsters in themed packs at biome-appropriate lairs. Seeded off the
  // world seed so the same world always grows the same dwellings.
  const rng = mulberry32((world.seed ^ 0x9e3779b9) >>> 0);
  let made = 0;
  for (const spec of LAIRS) {
    const def = MONSTERS[spec.monster];
    if (!def) continue;
    for (let l = 0; l < spec.lairs; l++) {
      const anchor = findLairAnchor(world, def, spec, rng);
      if (!anchor) continue;
      const pack = spec.packMin + Math.floor(rng() * (spec.packMax - spec.packMin + 1));
      for (let k = 0; k < pack; k++) {
        const pos = placeNear(world, anchor, LAIR_RADIUS, rng);
        if (!pos) continue;
        const id = `m${++made}`;
        monsters.set(id, {
          id,
          def,
          pos,
          yaw: 0,
          hp: def.maxHp,
          spawn: { ...pos },
          leash: LEASH,
          alive: true,
          respawnAtTick: 0,
          targetPlayerId: null,
          lastAttackTick: 0,
          heading: rng() * Math.PI * 2,
          headingTicks: 0,
        });
      }
    }
  }

  return { monsters, npcs };
}

/** Roll a monster's loot table into concrete item stacks. */
export function rollLoot(def: MonsterDef): { item: string; count: number }[] {
  const out: { item: string; count: number }[] = [];
  for (const drop of def.loot) {
    if (Math.random() > drop.chance) continue;
    const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
    if (count > 0) out.push({ item: drop.item, count });
  }
  return out;
}
