// Living entities the server simulates: wandering monsters and town NPCs.
// Spawning places them on the terrain surface; AI/combat is driven by the
// game server's tick (it owns player state). Loot is rolled here.

import { Biome } from "../shared/biomes";
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
  alive: boolean;
  respawnAtTick: number;
  targetPlayerId: string | null;
  lastAttackTick: number;
  /** Current wander heading (radians) and how long to keep it. */
  heading: number;
  headingTicks: number;
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

export function spawnWorldEntities(world: World, monsterCount: number): WorldEntities {
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

  let made = 0;
  const addMonster = (def: MonsterDef, x: number, z: number): boolean => {
    const pos = surfacePos(world, x, z);
    if (pos.y <= 1) return false; // skip deep water / void
    const id = `m${++made}`;
    monsters.set(id, {
      id,
      def,
      pos,
      yaw: 0,
      hp: def.maxHp,
      spawn: { ...pos },
      alive: true,
      respawnAtTick: 0,
      targetPlayerId: null,
      lastAttackTick: 0,
      heading: Math.random() * Math.PI * 2,
      headingTicks: 0,
    });
    return true;
  };

  // Scatter monsters on valid biomes within a ring around the origin,
  // weighted so rare creatures (bosses) stay rare.
  let attempts = 0;
  while (made < monsterCount && attempts < monsterCount * 20) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 90;
    const x = Math.round(Math.cos(angle) * dist);
    const z = Math.round(Math.sin(angle) * dist);
    const biome = world.biomeAt(x, z);
    const candidates = Object.values(MONSTERS).filter((m) => m.biomes.includes(biome));
    if (candidates.length === 0) continue;
    const total = candidates.reduce((s, m) => s + (m.weight ?? 1), 0);
    let roll = Math.random() * total;
    let def = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= c.weight ?? 1;
      if (roll <= 0) {
        def = c;
        break;
      }
    }
    addMonster(def, x, z);
  }

  // Guarantee the boss exists somewhere: hunt outward for mountain terrain.
  const golem = MONSTERS.golem;
  let golems = [...monsters.values()].filter((m) => m.def.id === "golem").length;
  for (let r = 30; r <= 400 && golems < 2; r += 12) {
    for (let a = 0; a < Math.PI * 2 && golems < 2; a += Math.PI / 10) {
      const x = Math.round(Math.cos(a) * r);
      const z = Math.round(Math.sin(a) * r);
      if (world.biomeAt(x, z) === Biome.Mountains && addMonster(golem, x, z)) golems++;
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
