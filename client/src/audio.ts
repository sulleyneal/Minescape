// Procedural sound effects via WebAudio — zero audio assets. Every sound is
// synthesized from oscillators and filtered noise. The context unlocks on the
// first user gesture (a browser requirement).

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Install a one-time unlock listener; call once at boot. */
  init(): void {
    const unlock = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.25;
        this.master.connect(this.ctx.destination);
      } catch {
        /* no audio support */
      }
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.25;
    return this.muted;
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private ready(): boolean {
    return !!this.ctx && !this.muted;
  }

  /** A pitched blip: freq slides by `slide` Hz over its duration. */
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; slide?: number; when?: number } = {},
  ): void {
    if (!this.ready()) return;
    const { type = "square", gain = 0.15, slide = 0, when = 0 } = opts;
    const ctx = this.ctx!;
    const start = this.t + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** A burst of filtered noise (impacts, crumbles, whooshes). */
  private noise(dur: number, opts: { gain?: number; freq?: number; slide?: number; when?: number } = {}): void {
    if (!this.ready()) return;
    const { gain = 0.2, freq = 800, slide = 0, when = 0 } = opts;
    const ctx = this.ctx!;
    const start = this.t + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(freq, start);
    if (slide) filter.frequency.linearRampToValueAtTime(Math.max(60, freq + slide), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(start);
  }

  // ---- Game sounds ----

  mineTick(): void {
    this.noise(0.05, { freq: 1500, gain: 0.1 });
    this.tone(150 + Math.random() * 60, 0.05, { type: "triangle", gain: 0.06 });
  }

  chopTick(): void {
    this.tone(95, 0.07, { type: "square", gain: 0.1, slide: -25 });
    this.noise(0.06, { freq: 450, gain: 0.1 });
  }

  breakBlock(): void {
    this.noise(0.18, { freq: 900, slide: -650, gain: 0.24 });
  }

  place(): void {
    this.tone(210, 0.07, { type: "triangle", gain: 0.18, slide: -60 });
  }

  swing(): void {
    this.noise(0.12, { freq: 500, slide: 900, gain: 0.08 });
  }

  hit(dmg: number): void {
    if (dmg > 0) {
      this.noise(0.1, { freq: 600, gain: 0.2 });
      this.tone(110, 0.12, { type: "square", gain: 0.16, slide: -40 });
    } else {
      this.noise(0.05, { freq: 2200, gain: 0.06 }); // miss: faint tink
    }
  }

  hurt(dmg: number): void {
    if (dmg > 0) this.tone(220, 0.22, { type: "sawtooth", gain: 0.14, slide: -130 });
  }

  levelUp(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, { type: "triangle", gain: 0.16, when: i * 0.09 }));
  }

  questDone(): void {
    [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, { type: "triangle", gain: 0.16, when: i * 0.11 }));
  }

  coin(): void {
    this.tone(1175, 0.05, { type: "square", gain: 0.1 });
    this.tone(1568, 0.12, { type: "square", gain: 0.1, when: 0.05 });
  }

  craft(): void {
    this.tone(140, 0.06, { type: "square", gain: 0.14 });
    this.tone(190, 0.08, { type: "square", gain: 0.14, when: 0.09 });
  }

  death(): void {
    this.tone(180, 0.9, { type: "sawtooth", gain: 0.18, slide: -140 });
    this.noise(0.5, { freq: 300, slide: -200, gain: 0.12 });
  }

  uiClick(): void {
    this.tone(620, 0.03, { type: "triangle", gain: 0.07 });
  }
}

export const sfx = new SfxEngine();
