// Durable save/load for accounts and world edits. The default backend writes a
// single JSON file atomically; the Storage interface lets a database-backed
// backend drop in later without touching the game logic.

import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import pg from "pg";
import { ItemStack } from "../shared/items";

const { Pool } = pg;
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
  /** One-time setup (create tables, etc.). */
  init(): Promise<void>;
  load(): Promise<SaveData | null>;
  save(data: SaveData): Promise<void>;
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

  async init(): Promise<void> {}

  async load(): Promise<SaveData | null> {
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

  async save(data: SaveData): Promise<void> {
    // Atomic write: temp file then rename, so a crash mid-write can't corrupt the save.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }
}

/**
 * Durable cloud storage in a single Postgres JSONB row. Activated automatically
 * when DATABASE_URL is set (e.g. the database provisioned by render.yaml).
 */
export class PostgresStorage implements Storage {
  private pool: pg.Pool;

  constructor(url: string) {
    // Render's internal database URL needs no SSL; external ones do — opt in
    // with PGSSL=require.
    this.pool = new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init(): Promise<void> {
    await this.pool.query("CREATE TABLE IF NOT EXISTS minescape_save (id int PRIMARY KEY, data jsonb NOT NULL)");
    console.log("[minescape] using Postgres storage");
  }

  async load(): Promise<SaveData | null> {
    const res = await this.pool.query<{ data: SaveData }>("SELECT data FROM minescape_save WHERE id = 1");
    if (res.rows.length === 0) return null;
    const data = res.rows[0].data;
    if (data.version !== SAVE_VERSION) {
      console.warn(`[minescape] save version ${data.version} != ${SAVE_VERSION}; ignoring old save`);
      return null;
    }
    return data;
  }

  async save(data: SaveData): Promise<void> {
    await this.pool.query(
      "INSERT INTO minescape_save (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = $1::jsonb",
      [JSON.stringify(data)],
    );
  }
}
