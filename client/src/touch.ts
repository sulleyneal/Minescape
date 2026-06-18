// On-screen touch controls for phones/tablets: a movement joystick (bottom
// left), drag-anywhere-on-the-world to look, and action buttons (bottom right).
// Only created when the device has a coarse pointer. Feeds the same Controls
// input API the keyboard/mouse use, so the rest of the game is unchanged.

import { Controls } from "./controls";

export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

const JOY_RADIUS = 56; // px the knob can travel from center

export class TouchControls {
  constructor(
    private controls: Controls,
    private canvas: HTMLCanvasElement,
    private root: HTMLElement,
  ) {
    this.buildUi();
    this.bindLook();
  }

  private buildUi(): void {
    const wrap = document.createElement("div");
    wrap.id = "touch-ui";
    wrap.innerHTML = `
      <div id="joystick"><div id="joy-knob"></div></div>
      <div id="touch-buttons">
        <button class="tbtn" id="btn-craft" title="Crafting">⚒</button>
        <button class="tbtn" id="btn-jump" title="Jump">⤒</button>
        <button class="tbtn build" id="btn-build" title="Build">＋</button>
        <button class="tbtn mine" id="btn-mine" title="Mine / Chop / Fish">⛏</button>
      </div>`;
    this.root.appendChild(wrap);

    this.bindJoystick(wrap.querySelector("#joystick")!, wrap.querySelector("#joy-knob")!);
    this.bindButton(wrap.querySelector("#btn-jump")!, () => this.controls.requestJump());
    this.bindButton(wrap.querySelector("#btn-build")!, () => this.controls.triggerSecondary());
    // Mine is held: the game loop accumulates break progress while pressed.
    this.bindHeld(
      wrap.querySelector("#btn-mine")!,
      () => (this.controls.primaryHeld = true),
      () => (this.controls.primaryHeld = false),
    );
    this.bindButton(wrap.querySelector("#btn-craft")!, () => this.toggleCraft());

    // On touch, panels can't be dismissed with a key — tap to close them.
    for (const sel of ["#help", "#craft"]) {
      const panel = document.querySelector(sel);
      panel?.addEventListener("click", () => panel.classList.add("hidden"));
    }
  }

  private toggleCraft(): void {
    document.querySelector("#craft")?.classList.toggle("hidden");
  }

  private bindButton(el: Element, action: () => void): void {
    el.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        action();
      },
      { passive: false } as AddEventListenerOptions,
    );
  }

  private bindHeld(el: Element, onDown: () => void, onUp: () => void): void {
    const start = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    };
    el.addEventListener("pointerdown", start, { passive: false } as AddEventListenerOptions);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
  }

  private bindJoystick(base: Element, knob: HTMLElement): void {
    let touchId: number | null = null;
    let cx = 0;
    let cy = 0;

    const setFromTouch = (clientX: number, clientY: number) => {
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS;
        dy = (dy / dist) * JOY_RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.controls.touchStrafe = dx / JOY_RADIUS;
      this.controls.touchForward = -dy / JOY_RADIUS; // up = forward
    };

    const reset = () => {
      touchId = null;
      knob.style.transform = "translate(0,0)";
      this.controls.touchForward = 0;
      this.controls.touchStrafe = 0;
    };

    base.addEventListener(
      "touchstart",
      (e) => {
        const ev = e as TouchEvent;
        ev.preventDefault();
        ev.stopPropagation();
        const t = ev.changedTouches[0];
        touchId = t.identifier;
        const r = (base as HTMLElement).getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        setFromTouch(t.clientX, t.clientY);
      },
      { passive: false },
    );
    base.addEventListener(
      "touchmove",
      (e) => {
        const ev = e as TouchEvent;
        ev.preventDefault();
        for (const t of Array.from(ev.changedTouches)) {
          if (t.identifier === touchId) setFromTouch(t.clientX, t.clientY);
        }
      },
      { passive: false },
    );
    const end = (e: Event) => {
      for (const t of Array.from((e as TouchEvent).changedTouches)) {
        if (t.identifier === touchId) reset();
      }
    };
    base.addEventListener("touchend", end);
    base.addEventListener("touchcancel", end);
  }

  // Dragging on the world (canvas) rotates the camera.
  private bindLook(): void {
    let lookId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (lookId !== null) return;
        const t = e.changedTouches[0];
        lookId = t.identifier;
        lastX = t.clientX;
        lastY = t.clientY;
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== lookId) continue;
          this.controls.applyLook(t.clientX - lastX, t.clientY - lastY);
          lastX = t.clientX;
          lastY = t.clientY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === lookId) lookId = null;
      }
    };
    this.canvas.addEventListener("touchend", end);
    this.canvas.addEventListener("touchcancel", end);
  }
}
