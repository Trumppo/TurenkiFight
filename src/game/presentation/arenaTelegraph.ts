import Phaser from 'phaser';
import type { AudioCue } from './audio/cueBridge';

/** Presentation-only K-kauppa shelf event: 45 s cycle, final 3 s are a non-damaging telegraph. */
export const KKAUPPA_EVENT_PERIOD_TICKS = 45 * 60;
export const KKAUPPA_TELEGRAPH_TICKS = 3 * 60;

export function kkauppaTelegraphActive(fightTicks: number): boolean {
  if (!Number.isFinite(fightTicks) || fightTicks < 0) return false;
  return fightTicks % KKAUPPA_EVENT_PERIOD_TICKS >= KKAUPPA_EVENT_PERIOD_TICKS - KKAUPPA_TELEGRAPH_TICKS;
}

/** Small shelf-edge vibration marks and one shop-bell placeholder cue. Never changes game state. */
export class ArenaTelegraphPresentation {
  private readonly marks: Phaser.GameObjects.Graphics;
  private fightStartTick: number | null = null;
  private lastCueCycle = -1;
  private cueCount = 0;
  private active = false;

  constructor(scene: Phaser.Scene, private readonly playCue: (cue: AudioCue) => void) {
    this.marks = scene.add.graphics().setDepth(145).setVisible(false);
  }

  update(tick: number, fighting: boolean): void {
    this.active = false;
    this.marks.clear().setVisible(false);
    if (!fighting || !Number.isFinite(tick)) {
      this.fightStartTick = null;
      this.lastCueCycle = -1;
      return;
    }
    if (this.fightStartTick === null) this.fightStartTick = tick;
    const elapsed = Math.max(0, tick - this.fightStartTick);
    const phase = elapsed % KKAUPPA_EVENT_PERIOD_TICKS;
    if (!kkauppaTelegraphActive(elapsed)) return;

    const cycle = Math.floor(elapsed / KKAUPPA_EVENT_PERIOD_TICKS);
    if (cycle !== this.lastCueCycle) {
      this.lastCueCycle = cycle;
      this.cueCount++;
      this.playCue('shop-bell');
    }
    this.active = true;
    this.marks.setVisible(true);
    const pulse = Math.floor(phase / 8) % 2 === 0;
    const jitter = Math.floor(phase / 4) % 2;
    this.marks.lineStyle(2, pulse ? 0xf0c878 : 0x9b7651, pulse ? 0.92 : 0.62);
    // A few tiny marks above the shelf edge imply a rattle without obscuring the shop or fighters.
    this.marks.beginPath();
    this.marks.moveTo(179 + jitter * 2, 149); this.marks.lineTo(185 + jitter * 2, 145);
    this.marks.moveTo(196 - jitter * 2, 157); this.marks.lineTo(202 - jitter * 2, 153);
    this.marks.moveTo(213 + jitter * 2, 166); this.marks.lineTo(219 + jitter * 2, 162);
    this.marks.strokePath();
    this.marks.fillStyle(0xf0c878, pulse ? 0.9 : 0.45);
    this.marks.fillRect(220, 144, 3, 3);
  }

  diagnostics(): { active: boolean; cueCount: number } {
    return { active: this.active, cueCount: this.cueCount };
  }

  destroy(): void {
    this.marks.destroy();
    this.fightStartTick = null;
    this.lastCueCycle = -1;
    this.cueCount = 0;
    this.active = false;
  }
}
