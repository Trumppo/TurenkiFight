import Phaser from 'phaser';
import type { AudioCue } from './audio/cueBridge';

export const STATION_EVENT_PERIOD_TICKS = 60 * 60;
export const STATION_EVENT_WARNING_TICKS = 5 * 60;
export const STATION_EVENT_PASS_TICKS = 3 * 60;

export type StationEventPhase = 'warning' | 'passing';
export type StationEvent = { phase: StationEventPhase; cycle: number; phaseTick: number };

/**
 * Station ambience is a pure function of the authoritative match tick. The
 * first warning starts at 55s, then repeats every 60s: five seconds warning,
 * followed by a three-second pass. No simulation state is read or changed.
 */
export function stationEventAtTick(tick: number): StationEvent | null {
  if (!Number.isSafeInteger(tick) || tick < 0) return null;
  const offset = tick % STATION_EVENT_PERIOD_TICKS;
  if (offset >= STATION_EVENT_PERIOD_TICKS - STATION_EVENT_WARNING_TICKS) {
    return {
      phase: 'warning',
      cycle: Math.floor(tick / STATION_EVENT_PERIOD_TICKS) + 1,
      phaseTick: offset - (STATION_EVENT_PERIOD_TICKS - STATION_EVENT_WARNING_TICKS),
    };
  }
  // Tick zero is not a pass left over from a hypothetical negative-tick event.
  if (tick >= STATION_EVENT_PERIOD_TICKS && offset < STATION_EVENT_PASS_TICKS) {
    return { phase: 'passing', cycle: Math.floor(tick / STATION_EVENT_PERIOD_TICKS), phaseTick: STATION_EVENT_WARNING_TICKS + offset };
  }
  return null;
}

/** Harmless station platform lights and a once-per-cycle procedural announcement cue. */
export class StationEventPresentation {
  private readonly lights: Phaser.GameObjects.Graphics;
  private lastCueCycle = -1;
  private lastObservedTick: number | null = null;
  private cueCount = 0;
  private active: StationEvent | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly status: HTMLElement,
    private readonly playCue: (cue: AudioCue) => void,
    private readonly retro: boolean,
  ) {
    this.lights = scene.add.graphics().setDepth(119).setVisible(false);
  }

  update(tick: number, fighting: boolean): void {
    if (Number.isSafeInteger(tick) && tick >= 0) {
      // A local reset/rematch starts a new tick domain; its same-numbered event
      // cycle must be eligible for its own one-shot cue.
      if (this.lastObservedTick !== null && tick < this.lastObservedTick) this.lastCueCycle = -1;
      this.lastObservedTick = tick;
    }
    this.active = fighting ? stationEventAtTick(tick) : null;
    this.lights.clear().setVisible(!!this.active);
    this.status.hidden = !this.active;
    if (!this.active) {
      this.status.textContent = '';
      return;
    }

    this.status.textContent = this.active.phase === 'warning'
      ? 'TRAIN APPROACH · PLATFORM LIGHTS ONLY'
      : 'TRAIN PASSING · PLATFORM LIGHTS ONLY';
    if (this.active.cycle !== this.lastCueCycle) {
      this.lastCueCycle = this.active.cycle;
      this.cueCount++;
      this.playCue('station-train');
    }

    // A restrained pixel pulse follows the station platform edge, below the
    // fighters' silhouettes. It is ambience only; train damage is a future
    // rules decision and is intentionally not implied or implemented here.
    const warningPulse = Math.floor(this.active.phaseTick / 15) % 2 === 0;
    const lightCount = 8;
    const activeLight = this.active.phase === 'passing'
      ? Math.floor((this.active.phaseTick - STATION_EVENT_WARNING_TICKS) / 22) % lightCount
      : -1;
    const warm = this.retro ? 0xffd47d : 0xffe19a;
    const cool = this.retro ? 0x8de0ca : 0x9ed8e5;
    for (let index = 0; index < lightCount; index++) {
      const x = 25 + index * 84;
      const passing = this.active.phase === 'passing';
      const lit = passing ? index === activeLight || index === (activeLight + 1) % lightCount : warningPulse;
      const color = passing ? cool : warm;
      this.lights.fillStyle(color, lit ? (passing ? 0.92 : 0.82) : 0.22);
      this.lights.fillRect(x, 204, 7, 3);
      if (lit) {
        this.lights.fillStyle(color, 0.42);
        this.lights.fillRect(x + 1, 202, 5, 1);
      }
    }
  }

  diagnostics(): { active: boolean; phase: StationEventPhase | null; cycle: number | null; cueCount: number } {
    return { active: !!this.active, phase: this.active?.phase ?? null, cycle: this.active?.cycle ?? null, cueCount: this.cueCount };
  }

  destroy(): void {
    this.lights.destroy();
    this.lastCueCycle = -1;
    this.lastObservedTick = null;
    this.cueCount = 0;
    this.active = null;
    this.status.hidden = true;
    this.status.textContent = '';
  }
}
