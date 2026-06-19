// Equipment slots and the combat bonuses worn gear provides. Equipped items
// live in dedicated slots (not the backpack) and their bonuses drive combat.

import { ITEMS } from "./items";

export type EquipSlot = "weapon" | "shield" | "helmet" | "body" | "legs";

export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "shield", "helmet", "body", "legs"];

export const SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: "Weapon",
  shield: "Shield",
  helmet: "Helmet",
  body: "Body",
  legs: "Legs",
};

export interface EquipStats {
  slot: EquipSlot;
  attack?: number;
  strength?: number;
  defence?: number;
  /** Level required to wear/wield. */
  reqAttack?: number;
  reqDefence?: number;
}

export type Equipment = Record<EquipSlot, string | null>;

export function emptyEquipment(): Equipment {
  return { weapon: null, shield: null, helmet: null, body: null, legs: null };
}

export interface CombatBonuses {
  attack: number;
  strength: number;
  defence: number;
}

export function equipmentBonuses(equip: Equipment): CombatBonuses {
  const b: CombatBonuses = { attack: 0, strength: 0, defence: 0 };
  for (const slot of EQUIP_SLOTS) {
    const id = equip[slot];
    const e = id ? ITEMS[id]?.equip : undefined;
    if (!e) continue;
    b.attack += e.attack ?? 0;
    b.strength += e.strength ?? 0;
    b.defence += e.defence ?? 0;
  }
  return b;
}

/** Colors for the equipped armor pieces, for drawing them on the avatar. */
export interface Gear {
  helmet?: string;
  body?: string;
  legs?: string;
}

export function gearFromEquipment(equip: Equipment): Gear {
  const gear: Gear = {};
  if (equip.helmet) gear.helmet = ITEMS[equip.helmet]?.color;
  if (equip.body) gear.body = ITEMS[equip.body]?.color;
  if (equip.legs) gear.legs = ITEMS[equip.legs]?.color;
  return gear;
}
