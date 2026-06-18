# Minescape

A multiplayer sandbox game that crosses **RuneScape's** skills and progression
with **Minecraft's** voxel world. Built for **1–8 players** who share one
persistent world running on a small authoritative server.

It runs entirely in the browser (TypeScript + [Three.js](https://threejs.org/))
with a Node.js WebSocket game server — so friends join by opening a single URL,
no install required.

## What's in this vertical slice

**The Minecraft backbone**
- Procedurally generated voxel world (seeded terrain, hills, lakes, trees, ore).
- Streamed chunks rendered with face-culled meshing — no texture assets needed.
- First-person controller with gravity, jumping, and voxel collision.
- Break and place blocks; every edit is synced to all players in real time.

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

To let friends join, expose port 5173 (e.g. with a tunnel) and share the URL.
Set a fixed world with `SEED=12345 npm run dev`.

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
