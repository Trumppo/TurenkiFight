/**
 * M10 Deathmatch identity: the shrinking safe platform.
 *
 * The zone is a pure function of the simulation tick. It has no state, no
 * random source and no snapshot field: every snapshot already carries `tick`,
 * so the local scene and an online client derive exactly the same bounds from
 * the same shared functions. Presentation detects a stage change by comparing
 * the previous and current tick.
 *
 * This module must stay presentation-free and deterministic.
 */

/**
 * Logical arena x-range. `step()` already clamps every fighter's x into this
 * range, so stage 0 (the full arena) never has an outside fighter in a normal
 * match. It is the reference width for every stage fraction.
 */
export const ARENA_MIN_X = 16;
export const ARENA_MAX_X = 368;

/** Horizontal centre every stage is centred on. */
export const ARENA_CENTRE_X = (ARENA_MIN_X + ARENA_MAX_X) / 2;

/** One stage of the shrink schedule. */
export type ZoneStage = {
  /** First simulation tick at which this stage is active. */
  readonly startTick: number;
  /** Width of the safe x-range as a fraction of the full arena range. */
  readonly widthFraction: number;
};

/**
 * The whole shrink schedule, in **global simulation ticks**. `tick` includes
 * the 180-tick countdown, so stage 1 at tick 1080 is 900 ticks (15 s at 60 Hz)
 * after `MatchStarted`, not 15 s after match creation; stages 1-5 are then 900
 * ticks apart.
 *
 * These are starting values, deliberately kept in one table so they can be
 * re-tuned after an owner playtest without touching the simulation logic.
 * `validateZoneStages` enforces that starts increase and widths never grow.
 */
export const ZONE_STAGES = [
  { startTick: 0, widthFraction: 1 },
  { startTick: 1080, widthFraction: 0.88 },
  { startTick: 1980, widthFraction: 0.76 },
  { startTick: 2880, widthFraction: 0.64 },
  { startTick: 3780, widthFraction: 0.52 },
  { startTick: 4680, widthFraction: 0.42 },
] as const satisfies readonly ZoneStage[];

/** HP removed from an outside fighter per zone damage tick. */
export const ZONE_DAMAGE_HP = 1;

/**
 * Damage cadence: an outside fighter loses `ZONE_DAMAGE_HP` on every tick
 * where `tick % 6 === 0`. Fixed to the tick timeline so it needs no per-fighter
 * accumulator state; any window of six consecutive ticks contains exactly one
 * damage tick.
 */
export const ZONE_DAMAGE_INTERVAL_TICKS = 6;

/** Safe x-range for one stage. Both bounds are inclusive. */
export type ZoneRange = { readonly minX: number; readonly maxX: number };

/** Fail fast on a mistuned schedule: starts must increase, widths must not grow. */
export function validateZoneStages(stages: readonly ZoneStage[]): void {
  if (stages.length === 0) throw new Error('Zone schedule must contain at least stage 0');
  let previous = stages[0];
  if (previous.startTick !== 0) throw new Error('Zone stage 0 must start at tick 0');
  for (const stage of stages) {
    if (!Number.isSafeInteger(stage.startTick) || stage.startTick < 0) {
      throw new Error(`Zone stage start tick must be a non-negative integer: ${stage.startTick}`);
    }
    if (!Number.isFinite(stage.widthFraction) || stage.widthFraction <= 0 || stage.widthFraction > 1) {
      throw new Error(`Zone stage width fraction must be in (0, 1]: ${stage.widthFraction}`);
    }
    if (stage !== previous) {
      if (stage.startTick <= previous.startTick) throw new Error('Zone stages must start at increasing ticks');
      if (stage.widthFraction > previous.widthFraction) throw new Error('Zone stages must not grow');
    }
    previous = stage;
  }
}

validateZoneStages(ZONE_STAGES);

/** Stage index active at `tick`; 0 before the first shrink, the last stage forever after. */
export function zoneStageAt(tick: number): number {
  let stage = 0;
  for (let index = 1; index < ZONE_STAGES.length; index++) {
    if (tick < ZONE_STAGES[index].startTick) break;
    stage = index;
  }
  return stage;
}

/** Safe x-range of one stage index, clamped to the schedule. */
export function zoneRangeForStage(stage: number): ZoneRange {
  const index = Math.max(0, Math.min(ZONE_STAGES.length - 1, Math.trunc(stage)));
  const width = (ARENA_MAX_X - ARENA_MIN_X) * ZONE_STAGES[index].widthFraction;
  return { minX: ARENA_CENTRE_X - width / 2, maxX: ARENA_CENTRE_X + width / 2 };
}

/** Safe x-range at `tick`, centred on the arena. */
export function zoneRangeAt(tick: number): ZoneRange {
  return zoneRangeForStage(zoneStageAt(tick));
}

/** True when `x` is inside the safe range at `tick`. Bounds are inclusive. */
export function isInsideZone(x: number, tick: number): boolean {
  const { minX, maxX } = zoneRangeAt(tick);
  return x >= minX && x <= maxX;
}

/**
 * First tick of the next shrink strictly after `tick`, or null once the last
 * stage is active. Presentation uses it for the "next shrink" HUD line.
 */
export function nextZoneShrinkTick(tick: number): number | null {
  for (const stage of ZONE_STAGES) {
    if (stage.startTick > tick) return stage.startTick;
  }
  return null;
}

/** True on the fixed ticks where outside fighters take zone damage. */
export function isZoneDamageTick(tick: number): boolean {
  return tick >= 0 && tick % ZONE_DAMAGE_INTERVAL_TICKS === 0;
}
