// Player avatar appearance: a small palette of body colors and skin tones,
// plus helpers to default and validate a chosen skin. Shared so the client
// picker and the server validation agree.

import { Skin } from "./protocol";

/** Selectable body/shirt colors. */
export const BODY_COLORS = [
  "#cc4444", "#3a6ea5", "#3a9a4a", "#9a6cff",
  "#e0a020", "#d24a8a", "#33b0b0", "#6a6f78",
];

/** Selectable head/skin tones. */
export const HEAD_TONES = ["#f0c8a0", "#e0b48a", "#c68642", "#8d5524", "#5a3a22"];

export function defaultSkin(name: string): Skin {
  // Deterministic per-name default so a fresh character isn't always identical.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { body: BODY_COLORS[h % BODY_COLORS.length], head: HEAD_TONES[(h >> 3) % HEAD_TONES.length] };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validate a client-supplied skin, falling back to a default. */
export function sanitizeSkin(skin: Skin | undefined, fallbackName: string): Skin {
  const def = defaultSkin(fallbackName);
  if (!skin) return def;
  return {
    body: HEX.test(skin.body) ? skin.body : def.body,
    head: HEX.test(skin.head) ? skin.head : def.head,
  };
}
