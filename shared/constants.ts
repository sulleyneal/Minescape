// Core world dimensions and tuning shared by client and server.
// Keeping these in one place guarantees the voxel maths line up on both ends.

export const CHUNK_SIZE = 16; // blocks per chunk edge (X and Z)
export const WORLD_HEIGHT = 64; // total vertical blocks
export const SEA_LEVEL = 24; // y at/below which water fills empty space

// How many chunks (radius) the server streams around each player.
export const VIEW_RADIUS = 6;

// Server simulation tick. RuneScape famously runs on a 0.6s tick; we keep the
// flavour for gathering/combat actions while letting movement be smooth.
export const TICK_MS = 600;

export const MAX_PLAYERS = 8;

// Full day/night cycle length in server ticks (1200 * 0.6s = 12 minutes).
// Time 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.
export const DAY_TICKS = 1200;
