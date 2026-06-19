// Procedural creature/NPC models built from Three.js primitives — no asset
// files. Each builder returns a Group whose origin is at the feet (y=0), so the
// renderer can drop it straight onto the terrain. Distinct silhouettes make the
// monster type readable at a glance (quadruped wolf, tailed scorpion, etc.).

import * as THREE from "three";

function mat(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function cone(r: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), mat(color));
  m.position.set(x, y, z);
  return m;
}

function darken(hex: string, f: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(f);
}

function buildGoblin(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = darken(color, 0.7);
  g.add(box(0.18, 0.4, 0.2, dark, -0.13, 0.2, 0)); // legs
  g.add(box(0.18, 0.4, 0.2, dark, 0.13, 0.2, 0));
  g.add(box(0.5, 0.55, 0.35, color, 0, 0.68, 0.04)); // hunched body
  g.add(box(0.14, 0.45, 0.16, color, -0.32, 0.62, 0.02)); // arms
  g.add(box(0.14, 0.45, 0.16, color, 0.32, 0.62, 0.02));
  g.add(box(0.5, 0.45, 0.45, color, 0, 1.18, 0.06)); // big head
  g.add(box(0.08, 0.08, 0.04, 0x1a1a1a, -0.12, 1.22, 0.29)); // eyes
  g.add(box(0.08, 0.08, 0.04, 0x1a1a1a, 0.12, 1.22, 0.29));
  const earL = cone(0.1, 0.3, color, -0.3, 1.3, 0); // pointy ears
  earL.rotation.z = Math.PI / 2.4;
  const earR = cone(0.1, 0.3, color, 0.3, 1.3, 0);
  earR.rotation.z = -Math.PI / 2.4;
  g.add(earL, earR);
  return g;
}

function buildWolf(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = darken(color, 0.75);
  g.add(box(0.5, 0.45, 1.1, color, 0, 0.6, 0)); // long body
  for (const [x, z] of [[-0.18, 0.42], [0.18, 0.42], [-0.18, -0.42], [0.18, -0.42]] as const) {
    g.add(box(0.16, 0.45, 0.16, dark, x, 0.22, z)); // four legs
  }
  g.add(box(0.42, 0.4, 0.4, color, 0, 0.72, 0.6)); // head forward
  g.add(box(0.24, 0.22, 0.25, dark, 0, 0.64, 0.82)); // snout
  g.add(cone(0.12, 0.25, color, -0.14, 1.0, 0.55)); // ears
  g.add(cone(0.12, 0.25, color, 0.14, 1.0, 0.55));
  const tail = box(0.14, 0.14, 0.5, color, 0, 0.7, -0.62);
  tail.rotation.x = -0.5;
  g.add(tail);
  return g;
}

function buildScorpion(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = darken(color, 0.7);
  g.add(box(0.6, 0.28, 0.9, color, 0, 0.3, 0)); // low flat body
  for (const [x, z] of [[-0.34, 0.3], [0.34, 0.3], [-0.34, -0.1], [0.34, -0.1]] as const) {
    g.add(box(0.1, 0.22, 0.1, dark, x, 0.18, z)); // legs
  }
  // Pincers reaching forward.
  g.add(box(0.16, 0.16, 0.4, dark, -0.34, 0.34, 0.6));
  g.add(box(0.16, 0.16, 0.4, dark, 0.34, 0.34, 0.6));
  g.add(box(0.24, 0.2, 0.2, color, -0.34, 0.34, 0.85));
  g.add(box(0.24, 0.2, 0.2, color, 0.34, 0.34, 0.85));
  // Segmented tail curving up over the back, ending in a stinger.
  const seg = [
    [0.42, -0.55, 0.45],
    [0.6, -0.7, 0.55],
    [0.8, -0.75, 0.5],
  ];
  for (const [y, z, _] of seg) g.add(box(0.18, 0.18, 0.18, color, 0, y, z));
  g.add(cone(0.12, 0.3, 0xdd3333, 0, 0.95, -0.7)); // stinger
  return g;
}

function buildSkeleton(): THREE.Group {
  const g = new THREE.Group();
  const bone = "#e6e2d2";
  const shadow = "#b8b2a0";
  g.add(box(0.14, 0.55, 0.14, bone, -0.13, 0.28, 0)); // thin legs
  g.add(box(0.14, 0.55, 0.14, bone, 0.13, 0.28, 0));
  g.add(box(0.32, 0.5, 0.2, shadow, 0, 0.8, 0)); // ribcage (darker)
  g.add(box(0.36, 0.08, 0.22, bone, 0, 0.92, 0)); // shoulders
  g.add(box(0.1, 0.5, 0.1, bone, -0.26, 0.78, 0)); // arms
  g.add(box(0.1, 0.5, 0.1, bone, 0.26, 0.78, 0));
  g.add(box(0.34, 0.36, 0.34, bone, 0, 1.28, 0)); // skull
  g.add(box(0.08, 0.1, 0.04, 0x111111, -0.08, 1.3, 0.18)); // eye sockets
  g.add(box(0.08, 0.1, 0.04, 0x111111, 0.08, 1.3, 0.18));
  return g;
}

function buildNpc(role: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const skin = "#e0b48a";
  const dark = darken(color, 0.75);
  g.add(box(0.18, 0.35, 0.2, dark, -0.13, 0.18, 0)); // legs/boots
  g.add(box(0.18, 0.35, 0.2, dark, 0.13, 0.18, 0));
  g.add(box(0.56, 0.85, 0.36, color, 0, 0.78, 0)); // long robe
  g.add(box(0.14, 0.6, 0.16, color, -0.34, 0.85, 0)); // arms
  g.add(box(0.14, 0.6, 0.16, color, 0.34, 0.85, 0));
  g.add(box(0.42, 0.42, 0.42, skin, 0, 1.42, 0)); // head
  g.add(box(0.08, 0.08, 0.04, 0x1a1a1a, -0.1, 1.46, 0.21)); // eyes
  g.add(box(0.08, 0.08, 0.04, 0x1a1a1a, 0.1, 1.46, 0.21));
  if (role === "banker") g.add(box(0.5, 0.16, 0.5, dark, 0, 1.7, 0)); // brimmed hat
  else if (role === "quest") {
    g.add(box(0.46, 0.3, 0.46, "#8a8a92", 0, 1.66, 0)); // helmet
    const sword = box(0.08, 0.7, 0.08, "#c8c8d0", 0.42, 0.95, 0.1); // sheathed blade
    sword.rotation.z = 0.3;
    g.add(sword);
  } else if (role === "shop") {
    g.add(box(0.5, 0.45, 0.05, darken(color, 0.6), 0, 0.7, 0.2)); // apron
  }
  return g;
}

export function buildMonsterModel(type: string, color: string): THREE.Group {
  switch (type) {
    case "wolf":
      return buildWolf(color);
    case "scorpion":
      return buildScorpion(color);
    case "skeleton":
      return buildSkeleton();
    case "goblin":
    default:
      return buildGoblin(color);
  }
}

export function buildNpcModel(role: string, color: string): THREE.Group {
  return buildNpc(role, color);
}
