// Durable save/load for accounts and world edits. The default backend writes a
// single JSON file atomically; the Storage interface lets a database-backed
// backend drop in later without touching the game logic.

import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ItemStack } from "../shared/items";
import { Vec3 } from "../shared/protocol";
import { Skills } from "../shared/skills";

export const SAVE_VERSION = 1;

export interface QuestSave {
  active: string[];
  progress: Record<string, number>;
  done: string[];
}

export interface PlayerSave {
  name: string;
  salt: string | null;
  passHash: string | null;
  skills: Skills;
  inventory: (ItemStack | null)[];
  bank: (ItemStack | null)[];
  hp: number;
  pos: Vec3;
  yaw: number;
  quest: QuestSave;
  lastSeen: number;
}

export interface SaveData {
  version: number;
  seed: number;
  accounts: Record<string, PlayerSave>;
  /** Player block edits relative to generation: [x, y, z, blockId]. */
  world: [number, number, number, number][];
}

export interface Storage {
  load(): SaveData | null;
  save(data: SaveData): void;
}

export function hashPassword(pw: string): { salt: string; hash: string } | null {
  if (!pw) return null;
  const salt = randomBytes(8).toString("hex");
  const hash = scryptSync(pw, salt, 32).toString("hex");
  return { salt, hash };
}

export function verifyPassword(pw: string, salt: string | null, hash: string | null): boolean {
  if (!hash || !salt) return true; // account has no password set
  if (!pw) return false;
  const got = scryptSync(pw, salt, 32).toString("hex");
  // Constant-ish comparison.
  return createHash("sha256").update(got).digest("hex") === createHash("sha256").update(hash).digest("hex");
}

export class FileStorage implements Storage {
  constructor(private path: string) {}

  load(): SaveData | null {
    if (!existsSync(this.path)) return null;
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8")) as SaveData;
      if (data.version !== SAVE_VERSION) {
        console.warn(`[minescape] save version ${data.version} != ${SAVE_VERSION}; ignoring old save`);
        return null;
      }
      return data;
    } catch (err) {
      console.error("[minescape] failed to read save:", err);
      return null;
    }
  }

  save(data: SaveData): void {
    // Atomic write: temp file then rename, so a crash mid-write can't corrupt the save.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }
}
