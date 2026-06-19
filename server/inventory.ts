// Server-side inventory helpers operating on the 28-slot backpack.

import { INVENTORY_SLOTS, ITEMS, ItemStack } from "../shared/items";

export type Inventory = (ItemStack | null)[];

export function emptyInventory(): Inventory {
  return new Array(INVENTORY_SLOTS).fill(null);
}

/** New players start with a basic toolkit so every action works immediately. */
export function startingInventory(): Inventory {
  const inv = emptyInventory();
  inv[0] = { item: "bronze_pickaxe", count: 1 };
  inv[1] = { item: "bronze_axe", count: 1 };
  inv[2] = { item: "bronze_shovel", count: 1 };
  inv[3] = { item: "bronze_sword", count: 1 };
  inv[4] = { item: "coins", count: 25 };
  return inv;
}

/** Add count of an item; returns the amount that did NOT fit. */
export function addItem(inv: Inventory, item: string, count: number): number {
  const def = ITEMS[item];
  if (!def) return count;

  if (def.stackable) {
    const existing = inv.find((s) => s && s.item === item);
    if (existing) {
      existing.count += count;
      return 0;
    }
  }

  let remaining = count;
  while (remaining > 0) {
    const slot = inv.findIndex((s) => s === null);
    if (slot === -1) break;
    if (def.stackable) {
      inv[slot] = { item, count: remaining };
      remaining = 0;
    } else {
      inv[slot] = { item, count: 1 };
      remaining -= 1;
    }
  }
  return remaining;
}

export function countItem(inv: Inventory, item: string): number {
  return inv.reduce((sum, s) => (s && s.item === item ? sum + s.count : sum), 0);
}

/** Remove count of an item. Returns false (and changes nothing) if insufficient. */
export function removeItem(inv: Inventory, item: string, count: number): boolean {
  if (countItem(inv, item) < count) return false;
  let remaining = count;
  for (let i = 0; i < inv.length && remaining > 0; i++) {
    const slot = inv[i];
    if (!slot || slot.item !== item) continue;
    const take = Math.min(slot.count, remaining);
    slot.count -= take;
    remaining -= take;
    if (slot.count <= 0) inv[i] = null;
  }
  return true;
}

export function hasSpaceFor(inv: Inventory, item: string): boolean {
  const def = ITEMS[item];
  if (def?.stackable && inv.some((s) => s && s.item === item)) return true;
  return inv.some((s) => s === null);
}
