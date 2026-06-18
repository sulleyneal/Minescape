// Builds and updates the on-screen UI: skills panel, inventory (with the active
// placement slot), action-notice feed, chat, and the crafting menu. Pure DOM —
// no framework, just direct manipulation for a small fixed layout.

import { INVENTORY_SLOTS, ITEMS, ItemStack } from "../../shared/items";
import { RECIPES } from "../../shared/gathering";
import { ClientMessage } from "../../shared/protocol";
import { levelForXp, levelProgress, SKILL_NAMES, SKILL_ORDER, Skills, SkillId, totalLevel, xpForLevel } from "../../shared/skills";

export class Hud {
  private skillsEl: HTMLElement;
  private invEl: HTMLElement;
  private noticeEl: HTMLElement;
  private chatLogEl: HTMLElement;
  private chatInputEl: HTMLInputElement;
  private craftEl: HTMLElement;
  private totalEl: HTMLElement;

  private inventory: (ItemStack | null)[] = new Array(INVENTORY_SLOTS).fill(null);
  private skills: Skills | null = null;
  /** Index of the selected placeable item, or -1. */
  selectedSlot = -1;

  constructor(private root: HTMLElement, private send: (m: ClientMessage) => void) {
    root.innerHTML = TEMPLATE;
    this.skillsEl = root.querySelector("#skills")!;
    this.invEl = root.querySelector("#inventory")!;
    this.noticeEl = root.querySelector("#notices")!;
    this.chatLogEl = root.querySelector("#chat-log")!;
    this.chatInputEl = root.querySelector("#chat-input")!;
    this.craftEl = root.querySelector("#craft")!;
    this.totalEl = root.querySelector("#total-level")!;

    this.buildCraftMenu();
    this.bindChat();
    this.bindToggles();
  }

  // ---- input helpers ----

  isTyping(): boolean {
    return document.activeElement === this.chatInputEl;
  }

  /** Update the break-progress bar under the crosshair. 0 or <0 hides it. */
  setMineProgress(p: number): void {
    const bar = this.root.querySelector("#mine-bar") as HTMLElement | null;
    if (!bar) return;
    if (p <= 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "block";
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }

  private bindChat(): void {
    document.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        if (this.isTyping()) {
          const text = this.chatInputEl.value.trim();
          if (text) this.send({ t: "chat", text });
          this.chatInputEl.value = "";
          this.chatInputEl.blur();
        } else {
          this.chatInputEl.focus();
          e.preventDefault();
        }
      } else if (e.code === "Escape" && this.isTyping()) {
        this.chatInputEl.blur();
      }
    });
  }

  private bindToggles(): void {
    document.addEventListener("keydown", (e) => {
      if (this.isTyping()) return;
      if (e.code === "KeyC") this.craftEl.classList.toggle("hidden");
      if (e.code === "KeyH") this.root.querySelector("#help")!.classList.toggle("hidden");
    });
  }

  private buildCraftMenu(): void {
    const list = this.craftEl.querySelector("#craft-list")!;
    for (const r of RECIPES) {
      const btn = document.createElement("button");
      btn.className = "craft-btn";
      const inputs = r.inputs.map((i) => `${i.count} ${ITEMS[i.item]?.name ?? i.item}`).join(", ");
      btn.innerHTML = `<b>${r.name}</b><span>${inputs} → ${r.output.count} ${ITEMS[r.output.item]?.name}</span>`;
      btn.onclick = () => this.send({ t: "craft", recipe: r.id });
      list.appendChild(btn);
    }
  }

  // ---- state updates from the server ----

  setInventory(inv: (ItemStack | null)[]): void {
    this.inventory = inv;
    // Clear selection if the slot emptied.
    if (this.selectedSlot >= 0 && !this.inventory[this.selectedSlot]) this.selectedSlot = -1;
    this.renderInventory();
  }

  setSkills(skills: Skills): void {
    this.skills = skills;
    this.renderSkills();
  }

  updateSkill(skill: string, xp: number, levelUp: boolean): void {
    if (!this.skills) return;
    this.skills[skill as SkillId] = xp;
    this.renderSkills();
    if (levelUp) {
      this.notice(`Congratulations! You reached ${SKILL_NAMES[skill as SkillId]} level ${levelForXp(xp)}!`, true);
    }
  }

  /** Item id of the currently selected placeable, or null. */
  selectedItem(): string | null {
    const stack = this.selectedSlot >= 0 ? this.inventory[this.selectedSlot] : null;
    if (stack && ITEMS[stack.item]?.placeBlock !== undefined) return stack.item;
    return null;
  }

  notice(text: string, highlight = false): void {
    const line = document.createElement("div");
    line.className = highlight ? "notice levelup" : "notice";
    line.textContent = text;
    this.noticeEl.appendChild(line);
    setTimeout(() => line.remove(), 5000);
    while (this.noticeEl.children.length > 6) this.noticeEl.removeChild(this.noticeEl.firstChild!);
  }

  chat(from: string, text: string): void {
    const line = document.createElement("div");
    line.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
    this.chatLogEl.appendChild(line);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    while (this.chatLogEl.children.length > 50) this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
  }

  setOnlineCount(_: number): void {
    /* reserved for a future player list */
  }

  // ---- rendering ----

  private renderSkills(): void {
    if (!this.skills) return;
    this.skillsEl.innerHTML = "";
    for (const s of SKILL_ORDER) {
      const xp = this.skills[s];
      const level = levelForXp(xp);
      const row = document.createElement("div");
      row.className = "skill-row";
      const next = xpForLevel(level + 1);
      row.title = `${Math.floor(xp)} xp${level < 99 ? ` (${next - Math.floor(xp)} to level ${level + 1})` : ""}`;
      row.innerHTML = `
        <span class="skill-name">${SKILL_NAMES[s]}</span>
        <span class="skill-level">${level}</span>
        <span class="skill-bar"><i style="width:${Math.round(levelProgress(xp) * 100)}%"></i></span>`;
      this.skillsEl.appendChild(row);
    }
    this.totalEl.textContent = `Total level: ${totalLevel(this.skills)}`;
  }

  private renderInventory(): void {
    this.invEl.innerHTML = "";
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const stack = this.inventory[i];
      const slot = document.createElement("div");
      slot.className = "slot";
      if (i === this.selectedSlot) slot.classList.add("selected");
      if (stack) {
        const def = ITEMS[stack.item];
        slot.style.background = def?.color ?? "#555";
        slot.title = def?.name ?? stack.item;
        if (stack.count > 1) {
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = String(stack.count);
          slot.appendChild(count);
        }
        const placeable = def?.placeBlock !== undefined;
        slot.onclick = () => {
          if (!placeable) return;
          this.selectedSlot = this.selectedSlot === i ? -1 : i;
          this.renderInventory();
        };
        if (placeable) slot.classList.add("placeable");
      }
      this.invEl.appendChild(slot);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const TEMPLATE = `
  <div id="crosshair">+</div>
  <div id="mine-bar"><i></i></div>
  <div id="panel-left">
    <div id="title">MINESCAPE</div>
    <div id="total-level">Total level: 6</div>
    <div id="skills"></div>
  </div>
  <div id="notices"></div>
  <div id="bottom">
    <div id="inventory"></div>
  </div>
  <div id="chat">
    <div id="chat-log"></div>
    <input id="chat-input" maxlength="200" placeholder="Press Enter to chat..." />
  </div>
  <div id="craft" class="panel hidden">
    <h3>Crafting (C)</h3>
    <div id="craft-list"></div>
  </div>
  <div id="help">
    <h3>How to play (H to toggle)</h3>
    <ul>
      <li><b>Click</b> the world to lock the mouse and look around</li>
      <li><b>WASD</b> move, <b>Space</b> jump</li>
      <li><b>Hold left click</b> to mine — harder blocks take longer; the bar under the crosshair shows progress</li>
      <li>Tools matter: <b>hatchet</b> for trees/wood, <b>pickaxe</b> for stone &amp; ore, <b>shovel</b> for dirt/sand. You start with bronze ones</li>
      <li>Hold left click on a tree / ore / water to gather (Woodcutting, Mining, Fishing)</li>
      <li>Deep down: <b>mossy stone</b>, glowing <b>runestone</b> and <b>Aether crystals</b>. Forge iron &amp; attune crystal tools in crafting (<b>C</b>)</li>
      <li>Select a placeable item in your pack, then <b>Right click</b> to build</li>
      <li><b>C</b> crafting · <b>Enter</b> chat · <b>H</b> help</li>
      <li><b>On a phone:</b> left joystick to move, drag the world to look, and use the buttons: ⛏ mine/gather, ＋ build, ⤒ jump, ⚒ craft. Tap a panel to close it.</li>
    </ul>
  </div>
`;
