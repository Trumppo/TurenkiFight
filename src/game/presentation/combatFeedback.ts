import type Phaser from 'phaser';
import type { GameEvent, GameState, Fighter } from '../simulation/types';

export const MAX_LIVE_HIT_SPARKS = 12;
const HIT_SPARK_LIFETIME_MS = 120;
const KNOCKOUT_CUE_LIFETIME_MS = 240;
const KNOCKOUT_FLASH_LIFETIME_MS = 90;
const MAX_LIVE_KNOCKOUT_CUES = 8;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

interface ImpactSpark {
  x: number;
  y: number;
  ageMs: number;
}

interface KnockoutCue {
  fighterId: string;
  x: number;
  y: number;
  ageMs: number;
}

function fighterById(fighters: readonly Fighter[], id: string | undefined): Fighter | undefined {
  return id ? fighters.find(fighter => fighter.id === id) : undefined;
}

function fighterCenter(fighter: Fighter): { x: number; y: number } {
  return { x: fighter.x, y: fighter.y - fighter.z - 24 };
}

/** Stores short-lived presentation cues. It has no access to or influence on simulation state. */
export class CombatFeedbackState {
  private readonly sparks: ImpactSpark[] = [];
  private readonly knockouts: KnockoutCue[] = [];
  private readonly seenEvents = new Map<string, number>();
  private lastEventTick = -1;

  observe(state: Pick<GameState, 'tick' | 'events' | 'fighters'>): void {
    if (state.tick < this.lastEventTick) this.seenEvents.clear();
    this.lastEventTick = state.tick;
    for (const [key, eventTick] of this.seenEvents) {
      if (eventTick < state.tick - 120) this.seenEvents.delete(key);
    }

    state.events.forEach((event, index) => {
      const key = `${event.tick}:${event.type}:${event.attacker ?? ''}:${event.target ?? ''}:${event.move ?? ''}:${index}`;
      if (this.seenEvents.has(key)) return;
      this.seenEvents.set(key, event.tick);

      if (event.type === 'HitLanded') this.addHitSpark(event, state.fighters);
      else if (event.type === 'Knockout') this.addKnockoutCue(event, state.fighters);
    });
  }

  /** Existing online health-delta fallback for snapshots without their event batch. */
  observeHealthDrop(fighter: Fighter): void {
    this.addSpark(fighterCenter(fighter));
  }

  advance(deltaMs: number): void {
    const elapsed = Math.max(0, deltaMs);
    for (const spark of this.sparks) spark.ageMs += elapsed;
    for (const cue of this.knockouts) cue.ageMs += elapsed;
    this.removeExpired(this.sparks, HIT_SPARK_LIFETIME_MS);
    this.removeExpired(this.knockouts, KNOCKOUT_CUE_LIFETIME_MS);
  }

  diagnostics(): { liveSparks: number; maxLiveSparks: number; knockoutTargets: string[] } {
    return {
      liveSparks: this.sparks.length,
      maxLiveSparks: MAX_LIVE_HIT_SPARKS,
      knockoutTargets: this.knockouts.map(cue => cue.fighterId),
    };
  }

  reset(): void {
    this.sparks.length = 0;
    this.knockouts.length = 0;
    this.seenEvents.clear();
    this.lastEventTick = -1;
  }

  draw(graphics: Phaser.GameObjects.Graphics, reducedMotion: boolean): void {
    graphics.clear();
    for (const spark of this.sparks) {
      const progress = clamp01(spark.ageMs / HIT_SPARK_LIFETIME_MS);
      if (reducedMotion) {
        graphics.fillStyle(0xffe3a0, 0.95).fillRect(Math.round(spark.x - 2), Math.round(spark.y - 2), 4, 4);
        continue;
      }
      const radius = Math.round(3 + progress * 3);
      const alpha = 1 - progress;
      graphics.lineStyle(2, 0xffe3a0, alpha);
      graphics.beginPath();
      graphics.moveTo(spark.x - radius, spark.y);
      graphics.lineTo(spark.x + radius, spark.y);
      graphics.moveTo(spark.x, spark.y - radius);
      graphics.lineTo(spark.x, spark.y + radius);
      graphics.strokePath();
      graphics.fillStyle(0xffa64d, alpha).fillRect(Math.round(spark.x - 1), Math.round(spark.y - 1), 2, 2);
    }

    for (const cue of this.knockouts) {
      const progress = clamp01(cue.ageMs / KNOCKOUT_CUE_LIFETIME_MS);
      const radius = Math.round(reducedMotion ? 9 : 9 + progress * 5);
      const alpha = reducedMotion ? 0.9 : 1 - progress;
      graphics.lineStyle(2, 0xfff1b7, alpha).strokeCircle(cue.x, cue.y, radius);
      if (!reducedMotion && cue.ageMs < KNOCKOUT_FLASH_LIFETIME_MS) {
        // A compact accent sits on the KO fighter only; it is not a screen flash.
        graphics.fillStyle(0xfff1b7, 0.45).fillRect(Math.round(cue.x - 2), Math.round(cue.y - 2), 4, 4);
      }
    }
  }

  private addHitSpark(event: GameEvent, fighters: readonly Fighter[]): void {
    const target = fighterById(fighters, event.target);
    if (!target) return;
    const attacker = fighterById(fighters, event.attacker);
    const center = fighterCenter(target);
    const position = attacker
      ? { x: (attacker.x + target.x) / 2, y: (attacker.y + attacker.z * -1 + target.y - target.z) / 2 - 24 }
      : center;
    this.addSpark(position);
  }

  private addKnockoutCue(event: GameEvent, fighters: readonly Fighter[]): void {
    const fighter = fighterById(fighters, event.target);
    if (!fighter) return;
    const { x } = fighterCenter(fighter);
    const y = fighter.y - fighter.z - 1;
    if (this.knockouts.length === MAX_LIVE_KNOCKOUT_CUES) this.knockouts.shift();
    this.knockouts.push({ fighterId: fighter.id, x: Math.round(x), y: Math.round(y), ageMs: 0 });
  }

  private addSpark(position: { x: number; y: number }): void {
    if (this.sparks.length === MAX_LIVE_HIT_SPARKS) this.sparks.shift();
    this.sparks.push({ x: Math.round(position.x), y: Math.round(position.y), ageMs: 0 });
  }

  private removeExpired<T extends { ageMs: number }>(items: T[], lifetime: number): void {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].ageMs >= lifetime) items.splice(i, 1);
  }
}
