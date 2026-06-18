// Browser entry point. Shows a tiny name prompt, then boots the game.

import { Game } from "./game";
import "./style.css";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("start") as HTMLElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;

nameInput.value = localStorage.getItem("minescape-name") ?? "";

async function boot(): Promise<void> {
  const name = nameInput.value.trim() || "Adventurer";
  localStorage.setItem("minescape-name", name);
  overlay.classList.add("hidden");
  const game = new Game(canvas, hudRoot, name);
  try {
    await game.start();
  } catch (err) {
    overlay.classList.remove("hidden");
    (document.getElementById("start-error") as HTMLElement).textContent =
      "Could not reach the game server. Is it running? (npm run dev)";
    console.error(err);
  }
}

playBtn.addEventListener("click", boot);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") boot();
});
