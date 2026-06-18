// Tiny deterministic value-noise implementation. Self-contained so the project
// has no native/binary dependencies — given the same seed every player and the
// server generate an identical world.

function hash2(seed: number, x: number, y: number): number {
  // Integer hash -> [0,1). Cheap but well-distributed enough for terrain.
  let h = seed ^ (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Value noise at continuous (x, y), output in [0,1). */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  const v00 = hash2(seed, x0, y0);
  const v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1);
  const v11 = hash2(seed, x0 + 1, y0 + 1);

  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

/** Fractal (multi-octave) noise in [0,1). */
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(seed + i * 1013, x * frequency, y * frequency) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / max;
}
