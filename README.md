# Minescape

A multiplayer sandbox game that crosses **RuneScape's** skills and progression
with **Minecraft's** voxel world. Built for **1–8 players** who share one
persistent world running on a small authoritative server.

It runs entirely in the browser (TypeScript + [Three.js](https://threejs.org/))
with a Node.js WebSocket game server — so friends join by opening a single URL,
no install required.

![Isometric preview of a generated Minescape world](./world-preview.png)

*An isometric render of an actual generated world (run `npx tsx tools/render-preview.ts` to make your own).*

![The procedural block textures](./texture-atlas.png)

*Block textures are generated procedurally on a canvas at runtime — no image
assets. Preview them with `npm i canvas && npx tsx tools/render-atlas.ts`.*

## What's in this vertical slice

**The Minecraft backbone**
- Procedurally generated voxel world (seeded terrain, hills, lakes, trees, ore,
  plus mystical mossy stone, glowing runestone and deep Aether crystals).
- Streamed chunks rendered with face-culled meshing, procedurally generated
  textures (built on a canvas — still no image assets), scene lighting, and a
  twilight "mystical" palette. Crystals and runes are self-lit.
- First-person controller with gravity, jumping, and voxel collision.
- **Tool-gated, timed mining:** hold to break; harder blocks take longer and
  need the right tool (hatchet for wood, pickaxe for stone/ore, shovel for
  dirt/sand). Tiers — Bronze → Iron → Aether (crystal) — break faster.
- Place blocks; every edit is synced to all players in real time.

**The RuneScape loop**
- Skills with the **authentic RuneScape XP curve** (level 1–99).
- Gathering nodes: chop **trees** (Woodcutting), mine **coal/iron/gold ore**
  (Mining), and fish **water** (Fishing), each with level requirements and XP.
- Resource nodes deplete and **respawn on a tick**, just like the real game.
- A 28-slot inventory and simple crafting (logs → planks, cook raw fish).
- Action notices ("You get some logs.") and level-up celebrations.

**Multiplayer**
- Up to 8 players in one world, with live avatars, name tags, and chat.

## Running it

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**. `npm run dev` starts both the WebSocket
game server (port 8080) and the Vite client; Vite proxies `/ws` to the server,
so everything is behind one URL.

Set a fixed world with `SEED=12345 npm run dev`.

## Hosting it on a public URL (play from anywhere)

For production the Node server serves the built client **and** the game
WebSocket on a single origin, so one URL is all you need.

```bash
npm run build   # bundle the client into dist/
npm start       # serve client + game on http://localhost:8080
```

**Deploy from your phone (no computer needed):** this repo includes a
[`render.yaml`](./render.yaml) Blueprint. Go to [render.com](https://render.com),
choose **New + → Blueprint**, pick this repository/branch, and Render builds and
hands you a public `https` URL. The free plan supports WebSockets. A
[`Dockerfile`](./Dockerfile) is also included for Fly.io / Railway / any VPS.

> **Note on phones:** the controls use a keyboard (WASD) and mouse pointer-lock,
> so the game is currently **playable on a computer**, not a touchscreen. Hosting
> lets you open the world from a phone and share the link with friends on
> laptops/desktops. On-screen touch controls are a planned next step.

## Controls

| Action | Input |
| --- | --- |
| Look around | Click to lock mouse, then move |
| Move / jump | WASD / Space |
| Gather or mine a block | Left click |
| Place selected block | Right click |
| Select placeable item | Click it in your pack |
| Crafting menu | C |
| Chat | Enter |
| Help | H |

## Project layout

```
shared/    Types, blocks, items, skills (XP curve), gathering rules, protocol
server/    Authoritative game server: world gen, sessions, tick loop
client/    Three.js client: rendering, controls, networking, HUD
```

The `shared/` folder is the contract: both the server and client import the same
block ids, item definitions, skill maths, and message types, so the two halves
can never drift out of sync.

## Where to take it next

This is a foundation, not a finished game. Natural next steps: combat and
monsters (the Attack skill is already defined), a bank, NPCs and quests, world
persistence to disk, smithing/cooking chains, and an equipment system.
