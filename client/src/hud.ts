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

  private bankItems: (ItemStack | null)[] = [];
  private shopName = "";
  private shopEntries: { item: string; price: number }[] = [];

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
    const help = this.root.querySelector("#help") as HTMLElement;

    // Close buttons (× ) work on desktop and touch.
    for (const btn of Array.from(this.root.querySelectorAll<HTMLElement>(".panel-close"))) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.closeUi) this.closeUi(btn.dataset.closeUi);
        else this.root.querySelector(btn.dataset.close!)?.classList.add("hidden");
      });
    }
    // Tapping the help text (no interactive parts) also closes it.
    help.addEventListener("click", () => help.classList.add("hidden"));
    this.panel("#respawn-btn").addEventListener("click", () => {
      this.hideDeath();
      this.send({ t: "respawn" });
    });

    document.addEventListener("keydown", (e) => {
      if (this.isTyping()) return;
      if (e.code === "Escape") {
        for (const ui of ["dialogue", "bank", "shop"]) {
          if (!this.panel("#" + ui).classList.contains("hidden")) this.closeUi(ui);
        }
      }
      if (this.isModalOpen()) return; // don't toggle panels behind a modal
      if (e.code === "KeyC") this.craftEl.classList.toggle("hidden");
      if (e.code === "KeyH") help.classList.toggle("hidden");
      // Once the player starts moving, get the help out of the way.
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) help.classList.add("hidden");
    });
  }

  private showTip(text: string): void {
    const tip = this.root.querySelector("#item-tip") as HTMLElement;
    tip.textContent = text;
    tip.style.opacity = "1";
  }

  private hideTip(): void {
    (this.root.querySelector("#item-tip") as HTMLElement).style.opacity = "0";
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
    if (!this.panel("#bank").classList.contains("hidden")) this.renderBank();
    if (!this.panel("#shop").classList.contains("hidden")) this.renderShop();
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
        if (def?.icon) {
          const icon = document.createElement("span");
          icon.className = "icon";
          icon.textContent = def.icon;
          slot.appendChild(icon);
        }
        if (stack.count > 1) {
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = String(stack.count);
          slot.appendChild(count);
        }
        // Show the item name on hover (works whenever the cursor is free).
        const label = def?.name ?? stack.item;
        slot.onmouseenter = () => this.showTip(label);
        slot.onmouseleave = () => this.hideTip();
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

  // ---- Combat / health / quests ----

  private panel(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  setHealth(hp: number, maxHp: number): void {
    const bar = this.panel("#health");
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    (bar.querySelector("i") as HTMLElement).style.width = `${frac * 100}%`;
    (bar.querySelector("span") as HTMLElement).textContent = `❤ ${Math.ceil(hp)}/${maxHp}`;
  }

  setQuest(q: { id: string; name: string; status: string; progress: number; goal: number }): void {
    const el = this.panel("#quest-tracker");
    if (q.status === "complete") {
      el.innerHTML = `<b>${q.name}</b><br>Complete — return to the quest giver!`;
    } else {
      el.innerHTML = `<b>${q.name}</b><br>Progress: ${q.progress}/${q.goal}`;
    }
    el.classList.remove("hidden");
  }

  /** Red flash + number when the player takes a hit. */
  flashPlayerDamage(dmg: number): void {
    const flash = this.panel("#dmg-flash");
    flash.textContent = String(dmg);
    flash.style.animation = "none";
    void flash.offsetWidth; // restart animation
    flash.style.animation = "dmgpop 0.6s ease-out";
  }

  showDeath(): void {
    this.closeModals();
    this.panel("#death").classList.remove("hidden");
    document.exitPointerLock?.();
  }
  hideDeath(): void {
    this.panel("#death").classList.add("hidden");
  }

  // ---- Dialogue ----

  showDialogue(msg: { npc: string; name: string; text: string; options: { id: string; label: string }[] }): void {
    document.exitPointerLock?.();
    const d = this.panel("#dialogue");
    d.querySelector(".dlg-name")!.textContent = msg.name;
    d.querySelector(".dlg-text")!.textContent = msg.text;
    const opts = d.querySelector(".dlg-options") as HTMLElement;
    opts.innerHTML = "";
    for (const o of msg.options) {
      const btn = document.createElement("button");
      btn.className = "dlg-btn";
      btn.textContent = o.label;
      btn.onclick = () => this.send({ t: "dialogueChoice", npc: msg.npc, option: o.id });
      opts.appendChild(btn);
    }
    d.classList.remove("hidden");
  }

  /** Hide a UI because the server told us to (no close action echoed back). */
  hideUi(ui: string): void {
    this.panel("#" + ui).classList.add("hidden");
  }

  closeUi(ui: string): void {
    if (ui === "dialogue") this.panel("#dialogue").classList.add("hidden");
    if (ui === "bank") {
      this.panel("#bank").classList.add("hidden");
      this.send({ t: "bankAction", action: "close", count: 0 });
    }
    if (ui === "shop") {
      this.panel("#shop").classList.add("hidden");
      this.send({ t: "shopAction", action: "close", count: 0 });
    }
  }

  // ---- Bank ----

  openBank(items: (ItemStack | null)[]): void {
    this.bankItems = items;
    document.exitPointerLock?.();
    this.panel("#bank").classList.remove("hidden");
    this.renderBank();
  }

  private renderBank(): void {
    if (!this.bankItems) return;
    const bankGrid = this.panel("#bank-items");
    const invGrid = this.panel("#bank-inv");
    this.renderGrid(bankGrid, this.bankItems, (i, stack) => {
      if (stack) this.send({ t: "bankAction", action: "withdraw", item: stack.item, count: stack.count });
    });
    this.renderGrid(invGrid, this.inventory, (i, stack) => {
      if (stack) this.send({ t: "bankAction", action: "deposit", slot: i, count: stack.count });
    });
  }

  // ---- Shop ----

  openShop(name: string, entries: { item: string; price: number }[]): void {
    this.shopName = name;
    this.shopEntries = entries;
    document.exitPointerLock?.();
    this.panel("#shop").classList.remove("hidden");
    this.renderShop();
  }

  private renderShop(): void {
    this.panel("#shop-title").textContent = this.shopName;
    const buyEl = this.panel("#shop-buy");
    buyEl.innerHTML = "";
    for (const e of this.shopEntries) {
      const def = ITEMS[e.item];
      const row = document.createElement("button");
      row.className = "shop-row";
      row.innerHTML = `<span>${def?.icon ?? ""} ${def?.name ?? e.item}</span><b>${e.price}🪙</b>`;
      row.onclick = () => this.send({ t: "shopAction", action: "buy", item: e.item, count: 1 });
      buyEl.appendChild(row);
    }
    const sellEl = this.panel("#shop-sell");
    this.renderGrid(sellEl, this.inventory, (i, stack) => {
      if (stack && ITEMS[stack.item]?.value && stack.item !== "coins") {
        this.send({ t: "shopAction", action: "sell", slot: i, count: stack.count });
      }
    });
  }

  // ---- shared grid renderer ----

  private renderGrid(container: HTMLElement, items: (ItemStack | null)[], onClick: (i: number, s: ItemStack | null) => void): void {
    container.innerHTML = "";
    items.forEach((stack, i) => {
      if (!stack && i >= 28 && !items.slice(i).some(Boolean)) return; // trim empty bank tail
      const slot = document.createElement("div");
      slot.className = "slot";
      if (stack) {
        const def = ITEMS[stack.item];
        slot.style.background = def?.color ?? "#555";
        slot.title = def?.name ?? stack.item;
        if (def?.icon) {
          const icon = document.createElement("span");
          icon.className = "icon";
          icon.textContent = def.icon;
          slot.appendChild(icon);
        }
        if (stack.count > 1) {
          const c = document.createElement("span");
          c.className = "count";
          c.textContent = stack.count > 9999 ? `${Math.floor(stack.count / 1000)}k` : String(stack.count);
          slot.appendChild(c);
        }
        slot.onclick = () => onClick(i, stack);
      }
      container.appendChild(slot);
    });
  }

  isModalOpen(): boolean {
    return ["#dialogue", "#bank", "#shop", "#death"].some((s) => !this.panel(s).classList.contains("hidden"));
  }

  private closeModals(): void {
    for (const s of ["#dialogue", "#bank", "#shop"]) this.panel(s).classList.add("hidden");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const TEMPLATE = `
  <div id="crosshair">+</div>
  <div id="mine-bar"><i></i></div>
  <div id="dmg-flash"></div>
  <div id="panel-left">
    <div id="title">MINESCAPE</div>
    <div id="total-level">Total level: 6</div>
    <div id="skills"></div>
  </div>
  <div id="health"><i></i><span>❤</span></div>
  <div id="quest-tracker" class="hidden"></div>
  <div id="notices"></div>

  <div id="dialogue" class="panel hidden">
    <div class="dlg-name"></div>
    <div class="dlg-text"></div>
    <div class="dlg-options"></div>
  </div>

  <div id="bank" class="panel hidden">
    <button class="panel-close" data-close-ui="bank">×</button>
    <h3>Bank</h3>
    <div class="bank-cols">
      <div><div class="grid-label">Bank (click to withdraw)</div><div id="bank-items" class="grid"></div></div>
      <div><div class="grid-label">Inventory (click to deposit)</div><div id="bank-inv" class="grid"></div></div>
    </div>
  </div>

  <div id="shop" class="panel hidden">
    <button class="panel-close" data-close-ui="shop">×</button>
    <h3 id="shop-title">Shop</h3>
    <div class="grid-label">Buy</div>
    <div id="shop-buy"></div>
    <div class="grid-label">Your items (click to sell)</div>
    <div id="shop-sell" class="grid"></div>
  </div>

  <div id="death" class="panel hidden">
    <h2>You died</h2>
    <p>The realm claims another soul... but not for long.</p>
    <button id="respawn-btn">Respawn</button>
  </div>
  <div id="bottom">
    <div id="item-tip"></div>
    <div id="inventory"></div>
  </div>
  <div id="chat">
    <div id="chat-log"></div>
    <input id="chat-input" maxlength="200" placeholder="Press Enter to chat..." />
  </div>
  <div id="craft" class="panel hidden">
    <button class="panel-close" data-close="#craft">×</button>
    <h3>Crafting (C)</h3>
    <div id="craft-list"></div>
  </div>
  <div id="help" class="panel">
    <button class="panel-close" data-close="#help">×</button>
    <h3>How to play</h3>
    <ul>
      <li><b>Click</b> the world to lock the mouse and look around</li>
      <li><b>WASD</b> move, <b>Space</b> jump</li>
      <li><b>Hold left click</b> to mine — harder blocks take longer; the bar under the crosshair shows progress</li>
      <li>Tools matter: <b>hatchet</b> for trees/wood, <b>pickaxe</b> for stone &amp; ore, <b>shovel</b> for dirt/sand. You start with bronze ones</li>
      <li>Hold left click on a tree / ore / water to gather (Woodcutting, Mining, Fishing)</li>
      <li><b>Click a monster</b> to fight it — mind your health bar! Click an <b>NPC</b> in the town to talk, bank, shop, or take a quest</li>
      <li>Explore: <b>plains, forests, deserts, snowy tundra and mountains</b>, each with their own creatures</li>
      <li>Deep down: <b>mossy stone</b>, glowing <b>runestone</b> and <b>Aether crystals</b>. Forge gear via Smithing in crafting (<b>C</b>)</li>
      <li>Select a placeable item in your pack, then <b>Right click</b> to build</li>
      <li><b>C</b> crafting · <b>Enter</b> chat · <b>H</b> help · <b>Esc</b> close menus</li>
      <li><b>On a phone:</b> left joystick to move, drag the world to look, and use the buttons: ⛏ mine/gather, ＋ build, ⤒ jump, ⚒ craft.</li>
      <li style="color:#ffd24a"><b>Close this:</b> click ×, press <b>H</b>, or just start moving.</li>
    </ul>
  </div>
`;
