import Phaser from 'phaser';
import { arenaRules, hazardPhaseAt, hazardWarningStart, isHazardDamageTick, isInsideHazardBand } from '../simulation/arenas';
import { TICK_RATE } from '../simulation/step';
import { isInsideZone, isZoneDamageTick } from '../simulation/zone';
import type { ArenaId, Fighter, GameState } from '../simulation/types';
import type { HazardPhase } from '../simulation/arenas';
import type { AudioCue } from './audio/cueBridge';

/**
 * Read-only shelf hazard presentation. All timing and geometry come from the
 * simulation's arena table and use the same global tick as damage resolution.
 */
export class ArenaTelegraphPresentation {
  private readonly band: Phaser.GameObjects.Graphics;
  private readonly damageEdge: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private lastCueCycle = -1;
  private cueCount = 0;
  private phase: HazardPhase = 'idle';
  private bandVisible = false;
  private warningStart = 0;
  private edgeVisible = false;
  private damageUntilTick = -1;

  constructor(scene: Phaser.Scene, private readonly playCue: (cue: AudioCue) => void) {
    // The marking sits just above the composite backdrop but below fighters,
    // shadows and the mode-zone overlay. Integer drawing keeps it pixel crisp.
    this.band = scene.add.graphics().setDepth(123).setVisible(false);
    this.damageEdge = scene.add.graphics().setScrollFactor(0).setDepth(10_000).setVisible(false);
    this.label = scene.add.text(388, 136, '', {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#e8c786', backgroundColor: '#172536',
      padding: { x: 4, y: 3 }, stroke: '#101820', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(10_001).setVisible(false);
  }

  /** Global simulation tick; an omitted arena is the station and has no band. */
  update(tick: number, fighting: boolean, arena?: ArenaId): void {
    const hazard = arenaRules(arena).hazard;
    this.phase = fighting ? hazardPhaseAt(tick, hazard) : 'idle';
    this.bandVisible = fighting && !!hazard;
    this.warningStart = hazard ? hazardWarningStart(hazard) : 0;
    this.band.clear().setVisible(this.bandVisible);
    this.label.setVisible(this.bandVisible);
    if (!fighting) {
      this.lastCueCycle = -1;
      this.damageUntilTick = -1;
    }

    if (this.bandVisible && hazard) {
      const phaseTick = tick % hazard.periodTicks;
      const pulse = Math.floor(phaseTick / 8) % 2 === 0;
      const active = this.phase === 'active';
      const warning = this.phase === 'warning';
      const color = active ? 0xf35445 : warning ? 0xffc04d : 0xd5aa61;
      const alpha = active ? (pulse ? 0.34 : 0.22) : warning ? (pulse ? 0.3 : 0.15) : 0.095;
      const band = hazard.band;
      const left = 16;
      const width = 352;
      const height = band.maxY - band.minY + 1;
      this.band.fillStyle(color, alpha);
      this.band.fillRect(left, band.minY, width, height);
      this.band.lineStyle(active ? 2 : warning ? 2 : 1, color, active ? 0.98 : warning ? (pulse ? 0.95 : 0.7) : 0.5);
      this.band.strokeRect(left, band.minY, width, height);
      this.band.lineStyle(1, color, active ? 0.65 : warning ? 0.55 : 0.24);
      for (let x = left + 8; x < left + width; x += 16) {
        this.band.beginPath();
        this.band.moveTo(x, band.minY + 2);
        this.band.lineTo(x + 7, band.minY + 9);
        this.band.moveTo(x, band.maxY - 2);
        this.band.lineTo(x + 7, band.maxY - 9);
        this.band.strokePath();
      }

      const warningSeconds = Math.ceil((hazard.periodTicks - hazard.activeTicks - phaseTick) / TICK_RATE);
      this.label.setText(warning ? `SHELF WARNING ${warningSeconds}S` : active ? 'SHELF DROP' : 'SHELF ZONE')
        .setColor(active ? '#ff8974' : warning ? (pulse ? '#ffe08a' : '#ffbd55') : '#ddc18b')
        .setBackgroundColor(active ? '#522c32' : warning ? '#493b24' : '#172536');

      if (this.phase === 'warning') {
        const cycle = Math.floor(tick / hazard.periodTicks);
        // Warn exactly once on warningStart, despite repeated render frames.
        if (tick % hazard.periodTicks >= this.warningStart && cycle !== this.lastCueCycle) {
          this.lastCueCycle = cycle;
          this.cueCount++;
          this.playCue('shop-bell');
        }
      }
    }

    this.edgeVisible = fighting && tick <= this.damageUntilTick;
    this.damageEdge.clear().setVisible(this.edgeVisible);
    if (this.edgeVisible) {
      this.damageEdge.fillStyle(0xf0443c, 0.22);
      this.damageEdge.fillRect(0, 0, 640, 8);
      this.damageEdge.fillRect(0, 352, 640, 8);
      this.damageEdge.fillRect(0, 8, 8, 344);
      this.damageEdge.fillRect(632, 8, 8, 344);
      this.damageEdge.lineStyle(2, 0xff8b72, 0.9);
      this.damageEdge.strokeRect(2, 2, 636, 356);
    }
  }

  /** Highlight a confirmed health loss without changing any authoritative data. */
  notifyDamage(tick: number): void {
    if (Number.isFinite(tick)) this.damageUntilTick = Math.max(this.damageUntilTick, tick + 18);
  }

  diagnostics(): { active: boolean; phase: HazardPhase; bandVisible: boolean; warningStart: number; cueCount: number; damageFeedback: boolean } {
    return {
      active: this.phase === 'warning',
      phase: this.phase,
      bandVisible: this.bandVisible,
      warningStart: this.warningStart,
      cueCount: this.cueCount,
      damageFeedback: this.edgeVisible,
    };
  }

  destroy(): void {
    this.band.destroy();
    this.damageEdge.destroy();
    this.label.destroy();
    this.lastCueCycle = -1;
    this.cueCount = 0;
    this.phase = 'idle';
    this.bandVisible = false;
    this.edgeVisible = false;
    this.damageUntilTick = -1;
  }
}

/**
 * Sparse online snapshots may skip intermediate ticks; look for a simulation
 * damage cadence tick in the observed interval and require both a health loss
 * and a position in/at the hazard band. This is presentation inference only.
 */
export function observedHazardDamage(
  previousTick: number,
  currentTick: number,
  arena: ArenaId | undefined,
  fighting: boolean,
  previousHealth: number,
  currentHealth: number,
  previousY: number,
  currentY: number,
): boolean {
  if (!fighting || currentHealth >= previousHealth) return false;
  const hazard = arenaRules(arena).hazard;
  if (!hazard || !isInsideHazardBand(previousY, hazard.band) && !isInsideHazardBand(currentY, hazard.band)) return false;
  const start = Math.max(0, Number.isFinite(previousTick) ? previousTick + 1 : currentTick);
  const end = Math.max(start, currentTick);
  for (let tick = start; tick <= end; tick++) if (isHazardDamageTick(tick, hazard)) return true;
  return false;
}

/** Avoid blaming the shelf when an earlier combat/Deathmatch-zone KO won the tick. */
export function hazardDamagePreemptedByKnockout(state: GameState, fighter: Fighter): boolean {
  if (state.events.some(event => event.type === 'Knockout' && event.target === fighter.id)) return true;
  return state.mode === 'deathmatch' && fighter.health === 0 && fighter.koTimer > 0 &&
    isZoneDamageTick(state.tick) && !isInsideZone(fighter.x, state.tick);
}
