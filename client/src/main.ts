// Browser entry point. Shows a name + password + skin prompt, then boots.

import { BODY_COLORS, HEAD_TONES } from "../../shared/appearance";
import { Game } from "./game";
import "./style.css";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("start") as HTMLElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const errorEl = document.getElementById("start-error") as HTMLElement;

nameInput.value = localStorage.getItem("minescape-name") ?? "";

// ---- Skin picker ----
const skin = {
  body: localStorage.getItem("minescape-body") ?? BODY_COLORS[0],
  head: localStorage.getItem("minescape-head") ?? HEAD_TONES[1],
};

function buildSwatches(el: HTMLElement, colors: string[], key: "body" | "head"): void {
  for (const color of colors) {
    const sw = document.createElement("button");
    sw.className = "swatch";
    sw.style.background = color;
    if (skin[key] === color) sw.classList.add("selected");
    sw.onclick = () => {
      skin[key] = color;
      localStorage.setItem(`minescape-${key}`, color);
      for (const c of Array.from(el.children)) c.classList.remove("selected");
      sw.classList.add("selected");
    };
    el.appendChild(sw);
  }
}
buildSwatches(document.getElementById("skin-body") as HTMLElement, BODY_COLORS, "body");
buildSwatches(document.getElementById("skin-head") as HTMLElement, HEAD_TONES, "head");

// After a rejected login we reload on the next attempt to avoid stacking games.
let needsReload = false;

async function boot(): Promise<void> {
  if (needsReload) {
    location.reload();
    return;
  }
  const name = nameInput.value.trim() || "Adventurer";
  const password = passwordInput.value;
  localStorage.setItem("minescape-name", name);
  errorEl.textContent = "";
  overlay.classList.add("hidden");
  const game = new Game(canvas, hudRoot, name, password, { ...skin });
  try {
    await game.start();
  } catch (err) {
    overlay.classList.remove("hidden");
    const msg = err instanceof Error ? err.message : "";
    errorEl.textContent = msg || "Could not reach the game server. Is it running?";
    needsReload = true; // a clean slate for the next try
    console.error(err);
  }
}

playBtn.addEventListener("click", boot);
for (const input of [nameInput, passwordInput]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") boot();
  });
}
