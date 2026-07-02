// Procedural creature/NPC models built from Three.js primitives — no asset
// files. Each builder returns a Group whose origin is at the feet (y=0).
// Limbs are pivot-jointed groups tagged via userData.limb ("legL", "legR",
// "armL", "armR", "tail") so the renderer can swing them in a walk cycle.

import * as THREE from "three";

function mat(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function glowMat(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color }); // unlit = glows at night
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

/** A limb that hangs from a pivot at (x, pivotY, z) and can swing around it. */
function limb(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  x: number,
  pivotY: number,
  z: number,
  tag: string,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, pivotY, z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = -h / 2;
  g.add(m);
  g.userData.limb = tag;
  return g;
}

function darken(hex: string, f: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(f);
}

function buildGoblin(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = darken(color, 0.7);
  g.add(limb(0.18, 0.4, 0.2, dark, -0.13, 0.4, 0, "legL"));
  g.add(limb(0.18, 0.4, 0.2, dark, 0.13, 0.4, 0, "legR"));
  g.add(box(0.5, 0.55, 0.35, color, 0, 0.68, 0.04)); // hunched body
  g.add(limb(0.14, 0.45, 0.16, color, -0.32, 0.85, 0.02, "armL"));
  g.add(limb(0.14, 0.45, 0.16, color, 0.32, 0.85, 0.02, "armR"));
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
  const legTags = ["legL", "legR", "legR", "legL"]; // diagonal gait
  ([[-0.18, 0.42], [0.18, 0.42], [-0.18, -0.42], [0.18, -0.42]] as const).forEach(([x, z], i) => {
    g.add(limb(0.16, 0.45, 0.16, dark, x, 0.45, z, legTags[i]));
  });
  g.add(box(0.42, 0.4, 0.4, color, 0, 0.72, 0.6)); // head forward
  g.add(box(0.24, 0.22, 0.25, dark, 0, 0.64, 0.82)); // snout
  g.add(cone(0.12, 0.25, color, -0.14, 1.0, 0.55)); // ears
  g.add(cone(0.12, 0.25, color, 0.14, 1.0, 0.55));
  const tail = new THREE.Group();
  tail.position.set(0, 0.7, -0.5);
  const tailMesh = box(0.14, 0.14, 0.5, color, 0, 0.06, -0.22);
  tailMesh.rotation.x = -0.5;
  tail.add(tailMesh);
  tail.userData.limb = "tail";
  g.add(tail);
  return g;
}

function buildScorpion(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = darken(color, 0.7);
  g.add(box(0.6, 0.28, 0.9, color, 0, 0.3, 0)); // low flat body
  const legTags = ["legL", "legR", "legR", "legL"];
  ([[-0.34, 0.3], [0.34, 0.3], [-0.34, -0.1], [0.34, -0.1]] as const).forEach(([x, z], i) => {
    g.add(limb(0.1, 0.22, 0.1, dark, x, 0.28, z, legTags[i]));
  });
  // Pincers reaching forward (small swing as "arms").
  const pincerL = new THREE.Group();
  pincerL.position.set(-0.34, 0.34, 0.4);
  pincerL.add(box(0.16, 0.16, 0.4, dark, 0, 0, 0.2), box(0.24, 0.2, 0.2, color, 0, 0, 0.45));
  pincerL.userData.limb = "armL";
  const pincerR = new THREE.Group();
  pincerR.position.set(0.34, 0.34, 0.4);
  pincerR.add(box(0.16, 0.16, 0.4, dark, 0, 0, 0.2), box(0.24, 0.2, 0.2, color, 0, 0, 0.45));
  pincerR.userData.limb = "armR";
  g.add(pincerL, pincerR);
  // Segmented tail curving up over the back, ending in a stinger.
  g.add(box(0.18, 0.18, 0.18, color, 0, 0.42, -0.55));
  g.add(box(0.18, 0.18, 0.18, color, 0, 0.6, -0.7));
  g.add(box(0.18, 0.18, 0.18, color, 0, 0.8, -0.75));
  g.add(cone(0.12, 0.3, 0xdd3333, 0, 0.95, -0.7)); // stinger
  return g;
}

function buildSkeleton(): THREE.Group {
  const g = new THREE.Group();
  const bone = "#e6e2d2";
  const shadow = "#b8b2a0";
  g.add(limb(0.14, 0.55, 0.14, bone, -0.13, 0.55, 0, "legL"));
  g.add(limb(0.14, 0.55, 0.14, bone, 0.13, 0.55, 0, "legR"));
  g.add(box(0.32, 0.5, 0.2, shadow, 0, 0.8, 0)); // ribcage (darker)
  g.add(box(0.36, 0.08, 0.22, bone, 0, 0.92, 0)); // shoulders
  g.add(limb(0.1, 0.5, 0.1, bone, -0.26, 1.0, 0, "armL"));
  g.add(limb(0.1, 0.5, 0.1, bone, 0.26, 1.0, 0, "armR"));
  g.add(box(0.34, 0.36, 0.34, bone, 0, 1.28, 0)); // skull
  g.add(box(0.08, 0.1, 0.04, 0x111111, -0.08, 1.3, 0.18)); // eye sockets
  g.add(box(0.08, 0.1, 0.04, 0x111111, 0.08, 1.3, 0.18));
  return g;
}

function buildGolem(color: string): THREE.Group {
  const g = new THREE.Group();
  const stone = "#5a628f";
  g.add(limb(0.36, 0.7, 0.42, stone, -0.3, 0.7, 0, "legL"));
  g.add(limb(0.36, 0.7, 0.42, stone, 0.3, 0.7, 0, "legR"));
  g.add(box(1.05, 0.95, 0.65, color, 0, 1.25, 0)); // massive torso
  g.add(box(0.38, 0.34, 0.55, stone, -0.65, 1.68, 0)); // pauldrons
  g.add(box(0.38, 0.34, 0.55, stone, 0.65, 1.68, 0));
  g.add(limb(0.3, 1.0, 0.36, stone, -0.68, 1.6, 0, "armL")); // long heavy arms
  g.add(limb(0.3, 1.0, 0.36, stone, 0.68, 1.6, 0, "armR"));
  g.add(box(0.5, 0.42, 0.45, color, 0, 2.0, 0)); // head
  // Glowing rune eyes + chest sigil (unlit so they shine at night).
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), glowMat("#7fe6ff"));
  eyeL.position.set(-0.11, 2.02, 0.24);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), glowMat("#7fe6ff"));
  eyeR.position.set(0.11, 2.02, 0.24);
  const sigil = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.03), glowMat("#9fbfff"));
  sigil.position.set(0, 1.3, 0.34);
  g.add(eyeL, eyeR, sigil);
  return g;
}

function buildNpc(role: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const skin = "#e0b48a";
  const dark = darken(color, 0.75);
  g.add(box(0.18, 0.35, 0.2, dark, -0.13, 0.18, 0)); // legs/boots
  g.add(box(0.18, 0.35, 0.2, dark, 0.13, 0.18, 0));
  g.add(box(0.56, 0.85, 0.36, color, 0, 0.78, 0)); // long robe
  g.add(limb(0.14, 0.6, 0.16, color, -0.34, 1.12, 0, "armL"));
  g.add(limb(0.14, 0.6, 0.16, color, 0.34, 1.12, 0, "armR"));
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
    case "golem":
      return buildGolem(color);
    case "goblin":
    default:
      return buildGoblin(color);
  }
}

export function buildNpcModel(role: string, color: string): THREE.Group {
  return buildNpc(role, color);
}

// ---- First-person held items (viewmodel) ----

/** Small tool/weapon models held in front of the camera. Origin at the grip. */
export function buildHeldModel(kind: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const wood = "#6b4a29";
  switch (kind) {
    case "pickaxe": {
      g.add(box(0.045, 0.42, 0.045, wood, 0, 0.1, 0));
      const head = box(0.34, 0.06, 0.06, color, 0, 0.32, 0);
      head.rotation.z = 0.06;
      g.add(head);
      g.add(box(0.05, 0.1, 0.05, color, -0.16, 0.27, 0), box(0.05, 0.1, 0.05, color, 0.16, 0.27, 0));
      break;
    }
    case "axe": {
      g.add(box(0.045, 0.42, 0.045, wood, 0, 0.1, 0));
      g.add(box(0.16, 0.18, 0.05, color, 0.09, 0.3, 0));
      break;
    }
    case "shovel": {
      g.add(box(0.045, 0.44, 0.045, wood, 0, 0.1, 0));
      g.add(box(0.12, 0.16, 0.04, color, 0, 0.36, 0));
      break;
    }
    case "sword": {
      g.add(box(0.05, 0.12, 0.05, wood, 0, -0.04, 0)); // grip
      g.add(box(0.16, 0.04, 0.06, color, 0, 0.03, 0)); // guard
      g.add(box(0.055, 0.42, 0.02, color, 0, 0.26, 0)); // blade
      break;
    }
    case "block": {
      g.add(box(0.18, 0.18, 0.18, color, 0, 0.14, 0));
      break;
    }
    default: {
      g.add(box(0.1, 0.16, 0.1, "#e0b48a", 0, 0.08, 0)); // bare hand
      break;
    }
  }
  return g;
}
