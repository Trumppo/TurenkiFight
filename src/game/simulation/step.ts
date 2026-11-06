import type { Direction, Fighter, GameState, PlayerInput, Move, GameEvent, ModeId, EndReason, PlayerId, SimObject, Team, WaveRules, WaveState } from './types';
import { aliveCount, modeRules, modeWinner } from './modes';
import { isZoneDamageTick, zoneRangeAt, ZONE_DAMAGE_HP } from './zone';
export { MATCH_TICKS } from './modes';
export { MODE_RULES, aliveCount, compareTieBreak, modeMetric, modeRules, modeWinner, WAVE_RULES } from './modes';
export type { EndReason, ModeId, ModeRules, RespawnPolicy, Team, TieBreakCriterion, WaveRules, WaveState } from './types';
export type MatchSetup = {
  ids?: string[];
  phase?: GameState['phase'];
  mode?: ModeId;
  /**
   * Explicit combat sides. Required in `wave` mode (both sides non-empty) and
   * optional elsewhere: an omitted team keeps the historical free-for-all.
   */
  teams?: Readonly<Record<PlayerId, Team>>;
};
export const TICK_RATE = 60;
export const COUNTDOWN_TICKS = 180;
/**
 * Axis movement speed in px per fixed tick. Owner decision 2026-11-06 (M11):
 * raise the original 1.3 px/tick baseline by 20 % so fighters feel faster.
 * 1.56 px/tick * 60 Hz = 93.6 px/s per axis; diagonals are normalised with
 * `Math.SQRT1_2` so they are not faster than axis movement.
 */
export const FIGHTER_SPEED = 1.56;
/** Derived for tests and documentation; never tune the literal above separately. */
export const FIGHTER_SPEED_PX_PER_SECOND = FIGHTER_SPEED * TICK_RATE;
export const MOVES: Record<Move, { startup: number; active: number; recovery: number; damage: number; points: number; reach: number; depth: number; height: number }> = {
  punch: { startup: 4, active: 5, recovery: 12, damage: 10, points: 100, reach: 32, depth: 14, height: 18 },
  kick: { startup: 7, active: 6, recovery: 16, damage: 15, points: 150, reach: 42, depth: 17, height: 20 },
  jumpkick: { startup: 6, active: 7, recovery: 18, damage: 20, points: 200, reach: 45, depth: 19, height: 30 },
  // A thrown bottle is a projectile hit, not a fighter attack: the startup,
  // active, recovery and reach fields are unused by the shared hit pipeline.
  throw: { startup: 0, active: 0, recovery: 0, damage: 20, points: 200, reach: 0, depth: 0, height: 0 },
};
/**
 * Arcade-feel constants (M11). All of them advance with the fixed tick; none
 * reads wall time or randomness.
 *
 * - `HIT_STOP_TICKS`: movement and attack progress freeze for this many ticks
 *   after a clean hit. A knockout uses the longer `KO_HIT_STOP_TICKS` so the
 *   knockout reads.
 * - `HITSTUN_TICKS`: unchanged helplessness window. It freezes with the fight
 *   rather than expiring during hit stop, so the knockback is always spread
 *   over the full hitstun window and a long freeze cannot strand a pending
 *   slide.
 * - `KNOCKBACK_PX`: deterministic push per move, spread over the hitstun frames
 *   in the attacker's facing direction.
 */
export const HIT_STOP_TICKS = 3;
export const KO_HIT_STOP_TICKS = 5;
export const HITSTUN_TICKS = 8;
export const KNOCKBACK_PX: Readonly<Record<Move, number>> = { punch: 2, kick: 4, jumpkick: 6, throw: 3 };
/**
 * M12 object layer. One bottle type, one deterministic spawn table. Nothing
 * here reads wall time or `Math.random`; the tick and the input edge are the
 * only inputs.
 *
 * - `intervalTicks`: a bottle spawns on every simulation tick divisible by 600
 *   (10 s at 60 Hz) while the phase is `fighting` and fewer than `maxUnbroken`
 *   objects are unbroken.
 * - `points`: fixed table, used in order and cycled by spawn tick. All points
 *   are inside `ARENA_BOUNDS`.
 * - Pickup reach and throw physics are fixed values, not per-object tuning.
 * - A broken object is removed in the same tick's cleanup pass, so a valid
 *   simulation state never carries `state: 'broken'`; the wire still accepts
 *   and validates it for forward compatibility.
 */
export const OBJECT_SPAWN_TABLE = {
  intervalTicks: 600,
  maxUnbroken: 3,
  points: [
    { x: 110, y: 190 },
    { x: 274, y: 138 },
    { x: 192, y: 176 },
  ],
} as const;
export const OBJECT_PICKUP_REACH_X = 18;
export const OBJECT_PICKUP_REACH_Y = 14;
/** Hand height while held; also the throw start height. */
export const HELD_OBJECT_Z = 12;
export const THROW_SPEED_X = 3;
export const THROW_START_Z = 12;
export const THROW_START_VZ = 2;
export const OBJECT_GRAVITY = 0.35;
export const THROW_HIT_RADIUS = 8;
export const THROW_HIT_HEIGHT = 24;
/**
 * Playable arena bounds. Fighters may not leave them through movement,
 * knockback or a respawn. `y` is the ground-plane depth.
 */
export const ARENA_BOUNDS = { minX: 16, maxX: 368, minY: 124, maxY: 204 } as const;
const clampX = (x: number): number => Math.max(ARENA_BOUNDS.minX, Math.min(ARENA_BOUNDS.maxX, x));
const clampY = (y: number): number => Math.max(ARENA_BOUNDS.minY, Math.min(ARENA_BOUNDS.maxY, y));

/** Numeric suffix of a generated object id (`O12` -> 12). */
function objectNumber(id: string): number {
  return Number(id.slice(1));
}
/**
 * Deterministic id allocation: one past the highest live id. A removed id may
 * be reused only after its object is gone, so two live objects never share an
 * id; no external state or counter field is needed on the wire.
 */
function nextObjectId(objects: readonly SimObject[]): string {
  let highest = 0;
  for (const object of objects) {
    const number = objectNumber(object.id);
    if (Number.isSafeInteger(number) && number > highest) highest = number;
  }
  return `O${highest + 1}`;
}
const unbrokenCount = (objects: readonly SimObject[]): number =>
  objects.reduce((count, object) => count + (object.state === 'broken' ? 0 : 1), 0);
/** A dropped bottle lands at its holder's current position and loses flight state. */
function dropObject(object: SimObject, holder?: Fighter): void {
  object.state = 'ground';
  object.z = 0;
  if (holder) {
    // Use the holder's post-movement position, not the object's previous
    // follow position, so a KO'd holder drops the bottle where it stood.
    object.x = clampX(holder.x);
    object.y = clampY(holder.y);
  }
  delete object.holder;
  delete object.vx;
  delete object.vz;
}

/**
 * Slide a hitstun target toward the last hit by an equal share of the
 * remaining push. The share divides by the hitstun frames that are still
 * going to run after this tick, so the total displacement equals the move's
 * `KNOCKBACK_PX` exactly and the clamp at a wall cannot leak movement later.
 */
function applyKnockback(f: Fighter): void {
  const remaining = f.knockback ?? 0;
  if (f.hitstun <= 0 || remaining === 0) return;
  const share = remaining / f.hitstun;
  f.x = clampX(f.x + share);
  const rest = f.hitstun === 1 ? 0 : remaining - share;
  if (rest === 0) delete f.knockback;
  else f.knockback = rest;
}
function spawn(index: number, count: number): { x: number; y: number } {
  return { x: 70 + (244 * index) / Math.max(1, count - 1), y: 148 + (index % 2) * 35 };
}
/**
 * Enemy slots active in a wave. The first wave activates `firstWaveEnemies`
 * slots and each later wave one more, capped by the roster. Slot order is the
 * stable roster order (spawn-point order), so the result is deterministic.
 */
function waveEnemyCount(wave: WaveRules, index: number, enemySlots: number): number {
  return Math.min(enemySlots, wave.firstWaveEnemies + index);
}
/**
 * True only when both fighters carry a side and it is the same side. A
 * teamless fighter keeps the historical free-for-all behaviour with everyone.
 */
function sameTeam(a: Fighter | undefined, b: Fighter | undefined): boolean {
  return a?.team !== undefined && b?.team !== undefined && a.team === b.team;
}
/**
 * Match creation accepts either the historical positional form
 * (`createState(ids, phase)`) or a setup object (`createState({ mode })`).
 * Score Brawl is the default and omits `mode` so the state keeps its canonical
 * shape. The M11 `hitStopTicks`/`knockback` fields are optional and absent when
 * zero, so an idle state keeps its pre-M11 bytes.
 *
 * Wave mode additionally assigns explicit teams and starts wave 1 immediately:
 * `wave.index` counts cleared waves (0 while wave 1 is being fought), the
 * pre-match countdown is still the normal `countdownTicks`, and enemy slots
 * beyond the first wave's count start eliminated until their wave revives them.
 */
export function createState(setup?: MatchSetup): GameState;
export function createState(ids?: string[], phase?: GameState['phase'], setup?: MatchSetup): GameState;
export function createState(
  idsOrSetup: string[] | MatchSetup = ['P1', 'P2'],
  phaseArg: GameState['phase'] = 'countdown',
  setupArg: MatchSetup = {},
): GameState {
  const arrayForm = Array.isArray(idsOrSetup);
  const setup = arrayForm ? setupArg : idsOrSetup;
  const ids = arrayForm ? idsOrSetup : setup.ids ?? ['P1', 'P2'];
  const phase = arrayForm ? phaseArg : setup.phase ?? 'countdown';
  if (ids.length < 1 || new Set(ids).size !== ids.length) throw new Error('Roster must contain unique players');
  const mode = setup.mode && setup.mode !== 'score-brawl' ? setup.mode : undefined;
  const rules = modeRules(mode);
  const teams = setup.teams;
  if (teams) {
    const roster = new Set(ids);
    for (const [id, team] of Object.entries(teams)) {
      if (!roster.has(id)) throw new Error('Team assignment contains an unknown player');
      if (team !== 'players' && team !== 'enemies') throw new Error('Invalid team');
    }
  }
  const wave = rules.wave;
  if (wave) {
    if (!teams) throw new Error('Wave mode requires a team assignment');
    const missing = ids.filter(id => teams[id] === undefined);
    if (missing.length) throw new Error('Wave mode requires a team for every fighter');
    const players = ids.filter(id => teams[id] === 'players').length;
    const enemies = ids.filter(id => teams[id] === 'enemies').length;
    if (players < 1 || enemies < 1) throw new Error('Wave mode needs at least one player and one enemy');
  }
  const extras: Partial<Fighter> = {};
  if (rules.fragScoring) extras.frags = 0;
  if (rules.trackDeaths) extras.deaths = 0;
  if (rules.trackDamage) extras.damageDealt = 0;
  if (rules.respawn === 'eliminate') extras.eliminated = false;
  const fighters = ids.map((id, i) => ({
    id, ...spawn(i, ids.length), z: 0, vz: 0, facing: (i % 2 ? -1 : 1) as -1 | 1,
    health: 100, score: 0, koCount: 0, hitsReceived: 0, attackCooldown: 0, attackFrames: 0, attackMove: null,
    hitTargets: [], hitstun: 0, koTimer: 0, protection: 0, previousButtons: [], ...extras,
    ...(teams?.[id] ? { team: teams[id] } : {}),
  }));
  let waveState: WaveState | undefined;
  if (wave) {
    const active = waveEnemyCount(wave, 0, fighters.filter(f => f.team === wave.enemyTeam).length);
    let seen = 0;
    for (const fighter of fighters) {
      if (fighter.team !== wave.enemyTeam) continue;
      // Enemy slots that are not part of wave 1 wait eliminated at their spawn
      // point; a later wave revives them with the same transition as a clear.
      if (seen++ >= active) { fighter.eliminated = true; fighter.health = 0; }
    }
    waveState = { index: 0, countdownTicks: 0, remaining: active };
  }
  return { tick: 0, phase, countdownTicks: COUNTDOWN_TICKS, remainingTicks: rules.timerTicks, events: [],
    ...(mode ? { mode } : {}),
    ...(waveState ? { wave: waveState } : {}),
    fighters };
}
export function standings(state: GameState): { id: string; rank: number; score: number }[] {
  const sorted = [...state.fighters].sort((a,b) => b.score-a.score || b.koCount-a.koCount || a.hitsReceived-b.hitsReceived || a.id.localeCompare(b.id));
  return sorted.map((f,i) => ({ id: f.id, score: f.score, rank: 1 + sorted.slice(0,i).filter(p => p.score > f.score || (p.score === f.score && (p.koCount > f.koCount || (p.koCount === f.koCount && p.hitsReceived < f.hitsReceived)))).length }));
}
export function step(state: GameState, inputs: PlayerInput[]): GameState {
  const rules = modeRules(state.mode);
  const objects = (state.objects ?? []).map(object => ({ ...object }));
  const fighters = state.fighters.map(f => {
    const copy = { ...f, hitTargets: [...f.hitTargets], previousButtons: [...f.previousButtons] };
    // Canonical in-memory form: a zero remainder is absent, so JSON.stringify
    // and the wire encoder agree and idle snapshots keep their old bytes.
    if (copy.knockback === 0) delete copy.knockback;
    return copy;
  });
  const next: GameState = { ...state, tick: state.tick + 1, fighters, events: [],
    ...(state.wave ? { wave: { ...state.wave } } : {}) };
  if (objects.length) next.objects = objects;
  else delete next.objects;
  if (next.hitStopTicks === 0) delete next.hitStopTicks;
  const event = (type: GameEvent['type'], extra: Partial<GameEvent> = {}) => next.events.push({ tick: next.tick, type, ...extra });
  const finish = (reason: EndReason, winner: PlayerId | null) => {
    next.phase = 'results';
    // A freeze cannot run in `results`; do not carry a stale counter into the
    // final snapshot.
    delete next.hitStopTicks;
    switch (rules.id) {
      case 'score-brawl':
        // Historical lifecycle event shape: no reason/winner for Score Brawl.
        event('MatchEnded');
        break;
      case 'last-man-standing':
      case 'deathmatch':
      case 'wave':
        event('MatchEnded', { reason, winner });
        break;
    }
  };
  /**
   * Shared knockout state transition. A combat knockout also credits score,
   * KO count and (in frag modes) a frag before calling this; a zone knockout
   * passes no attacker and therefore only records the death.
   */
  const knockOut = (target: Fighter) => {
    target.health = 0;
    target.attackMove = null;
    target.attackFrames = 0;
    target.hitstun = 0;
    delete target.knockback;
    // Wave enemies leave the current wave instead of respawning. The wave
    // lifecycle revives the active slots when the next wave starts.
    if (wave && target.team === wave.enemyTeam) {
      target.eliminated = true;
      target.koTimer = 0;
    } else if (rules.respawn === 'eliminate') {
      target.eliminated = true;
    } else {
      target.koTimer = 180;
      if (rules.trackDeaths) target.deaths = (target.deaths ?? 0) + 1;
    }
  };
  /**
   * Shared hit resolution for fighter attacks and thrown objects. Scoring,
   * damage, KO counters, hit stop and knockback are identical so a bottle is a
   * real hit rather than a special case. `facing` lets a projectile keep the
   * direction it was thrown even if the thrower has turned since.
   *
   * Teams are filtered here as well as in the hit scans: a teammate is never a
   * valid target, so friendly fire cannot land even if a scan is changed later.
   * In wave mode only the scoring team writes score (hit and KO alike), so
   * enemy hits on players stay scoreless as M13 requires.
   */
  const wave = rules.wave;
  const scores = (attacker: Fighter): boolean => !wave || attacker.team === wave.scoringTeam;
  const knockouts: { attacker: PlayerId; target: PlayerId }[] = [];
  const applyHit = (attacker: Fighter, target: Fighter, move: Move, facing: Direction = attacker.facing): void => {
    if (sameTeam(attacker, target)) return;
    const profile = MOVES[move];
    if (rules.hitScoring && scores(attacker)) attacker.score += profile.points;
    if (rules.trackDamage) attacker.damageDealt = (attacker.damageDealt ?? 0) + profile.damage;
    target.hitsReceived++;
    target.health = Math.max(0, target.health - profile.damage);
    event('HitLanded', { attacker: attacker.id, target: target.id, move });
    if (target.health === 0 && !target.koTimer) {
      if (rules.koScoring && scores(attacker)) { attacker.score += 500; target.score -= 200; }
      attacker.koCount++;
      event('Knockout', { attacker: attacker.id, target: target.id });
      knockOut(target);
      // A knockout reads longer than an ordinary hit. `max` keeps an existing
      // KO freeze at 5 and lets a later clean hit refresh but never shrink it.
      next.hitStopTicks = Math.max(next.hitStopTicks ?? 0, KO_HIT_STOP_TICKS);
      if (rules.fragScoring) knockouts.push({ attacker: attacker.id, target: target.id });
    } else if (!target.koTimer) {
      // Ordinary hit: refresh hitstun, queue the deterministic push and start
      // (or refresh) the 3-tick freeze. Hits in the same tick or during an
      // active freeze refresh the counter; they never exceed the KO maximum.
      target.hitstun = Math.max(target.hitstun, HITSTUN_TICKS);
      const pending = (target.knockback ?? 0) + KNOCKBACK_PX[move] * facing;
      if (pending === 0) delete target.knockback; else target.knockback = pending;
      next.hitStopTicks = Math.max(next.hitStopTicks ?? 0, HIT_STOP_TICKS);
    }
  };
  if (state.phase === 'results' || state.phase === 'lobby') return next;
  if (state.phase === 'countdown') {
    next.countdownTicks = Math.max(0, state.countdownTicks - 1);
    if (!next.countdownTicks) { next.phase = 'fighting'; event('MatchStarted'); }
    return next;
  }
  const byId = new Map(inputs.map(i => [i.playerId, i]));
  // Hit stop is a simulation counter, not wall time: one decrement per tick in
  // the fighting phase. While it is active the hitbox pass below still runs, so
  // a hit can refresh the counter (never past the KO maximum); movement, attack
  // frames, hitstun, jump physics and input edge detection are frozen. Match
  // timers (match clock, KO respawn, protection, zone) keep counting down.
  const frozen = (next.hitStopTicks ?? 0) > 0;
  if (frozen) {
    const remaining = (next.hitStopTicks ?? 0) - 1;
    if (remaining > 0) next.hitStopTicks = remaining;
    else delete next.hitStopTicks;
  }
  /** Fighters whose `grab` input produced a press edge on this tick. */
  const grabPressed = new Set<PlayerId>();
  for (const f of fighters) {
    // An eliminated fighter is out: no movement, attacks, edge detection or respawn.
    if (f.eliminated) continue;
    const i = byId.get(f.id);
    let pressed: string[] = [];
    let jumpPressed = false;
    if (!frozen) {
      const buttons: string[] = i ? [...(['punch','kick','jumpkick'] as const).filter(m => i[m] || (m === 'punch' && i.attack)), ...(i.jump ? ['jump'] : []), ...(i.grab ? ['grab'] : [])] : [];
      pressed = buttons.filter(b => !f.previousButtons.includes(b));
      jumpPressed = buttons.includes('jump') && !f.previousButtons.includes('jump');
      f.previousButtons = buttons;
    }
    if (f.koTimer > 0) {
      f.koTimer--;
      if (!f.koTimer) {
        if (rules.respawn === 'respawn') {
          // A fresh fighter must not reappear outside the current safe range.
          // Combat modes without a zone keep their exact historical spawn.
          const safe = rules.shrinkingZone ? zoneRangeAt(next.tick) : null;
          const clampX = (x: number): number => safe ? Math.max(safe.minX, Math.min(safe.maxX, x)) : x;
          const origin = spawn(fighters.indexOf(f), fighters.length);
          const options = [origin, ...Array.from({ length: 8 }, (_, i) => ({
            x: Math.max(16, Math.min(368, origin.x + (i % 2 ? 1 : -1) * (Math.floor(i / 2) + 1) * 32)),
            y: origin.y,
          }))].map(point => ({ x: clampX(point.x), y: point.y }));
          const s = options.find(p => fighters.every(other => other.id === f.id || other.koTimer > 0 || Math.hypot(other.x - p.x, other.y - p.y) >= 24)) ?? options[0];
          f.x = s.x; f.y = s.y; f.z = 0; f.vz = 0; f.health = 100; f.protection = 90; f.hitstun = 0; delete f.knockback;
          event('Respawned', { target: f.id });
        } else {
          f.eliminated = true; f.health = 0; f.attackMove = null; f.attackFrames = 0; f.hitstun = 0; delete f.knockback;
        }
      }
      continue;
    }
    if (f.protection > 0) f.protection--;
    if (frozen) {
      // Attack frames and hitstun are combat state: they freeze with the
      // fight, so the queued knockback is still spread over the full hitstun
      // window after the pause. Match timers (match clock, KO respawn,
      // protection, zone) already advanced above.
      continue;
    }
    const stunned = f.hitstun > 0;
    if (f.hitstun > 0) { applyKnockback(f); f.hitstun--; }
    if (f.attackFrames > 0) { f.attackFrames--; if (!f.attackFrames) f.attackMove=null; }
    f.attackCooldown = f.attackFrames;
    if (i && !stunned) {
      const scale = i.moveX && i.moveY ? Math.SQRT1_2 : 1;
      f.x = clampX(f.x + i.moveX * FIGHTER_SPEED * scale);
      f.y = clampY(f.y + i.moveY * FIGHTER_SPEED * scale);
      if (i.moveX) f.facing = i.moveX;
      if (jumpPressed && f.z === 0 && !f.attackMove) f.vz = 5.2;
      if (!f.attackMove) {
        // `grab` is an action, not a move: only the three fighter attacks may
        // seed `attackMove`.
        const move = pressed.find((m): m is 'punch' | 'kick' | 'jumpkick' =>
          (m === 'punch' || m === 'kick' || m === 'jumpkick') && (m === 'jumpkick' ? f.z > 0 : f.z === 0));
        if (move) { f.attackMove=move; const d=MOVES[move]; f.attackFrames=d.startup+d.active+d.recovery; f.attackCooldown=f.attackFrames; f.hitTargets=[]; f.protection=0; }
      }
      // Grab is processed after combat so it sees this tick's final position
      // and knockout state. A press is consumed by one action only: pickup
      // when empty-handed, throw when already holding.
      if (pressed.includes('grab')) grabPressed.add(f.id);
    }
    f.z = Math.max(0, f.z+f.vz);
    f.vz = f.z === 0 ? 0 : f.vz-0.35;
  }
  const hits: { attacker: Fighter; target: Fighter; move: Move }[] = [];
  for (const a of fighters) {
    if (a.eliminated || !a.attackMove || a.koTimer) continue;
    const m=MOVES[a.attackMove], elapsed=m.startup+m.active+m.recovery-a.attackFrames;
    if (elapsed < m.startup || elapsed >= m.startup+m.active) continue;
    for (const t of fighters) {
      if (a.id === t.id || t.koTimer || t.eliminated || t.protection || a.hitTargets.includes(t.id)) continue;
      // A teammate is never a target, so no auto-target and no friendly fire.
      if (sameTeam(a, t)) continue;
      const dx=(t.x-a.x)*a.facing;
      if (dx > 0 && dx <= m.reach && Math.abs(t.y-a.y) <= m.depth && Math.abs(t.z-a.z) <= m.height) hits.push({attacker:a,target:t,move:a.attackMove});
    }
  }
  hits.sort((a,b)=>a.attacker.id.localeCompare(b.attacker.id)||a.target.id.localeCompare(b.target.id));
  for (const h of hits) {
    const {attacker:a,target:t,move}=h;
    // Eligibility was captured before resolution: a fighter KO'd by an earlier
    // sorted hit can still land a simultaneous attack in this same tick.
    if (a.hitTargets.includes(t.id)) continue;
    // Eliminated fighters are no longer valid targets, even later in the same tick.
    if (t.eliminated) continue;
    a.hitTargets.push(t.id);
    applyHit(a, t, move);
  }
  /*
   * M12 object stage. Fixed per-tick order, after movement and combat and
   * before match timers (see `docs/M12_OBJECTS.md` and `tests/m12-items.test.ts`):
   *
   *   spawn -> drop/pickup -> throw -> flight -> impact/break -> cleanup
   *
   * Spawn runs first on its tick schedule. Drop and pickup are part of the
   * interaction stage so a KO'd holder releases its bottle before anyone else
   * can pick it up, and a bottle that appears can be grabbed on the same tick.
   * While hit stop is active the whole interaction/physics stage is frozen
   * exactly like fighter movement (drop, pickup, throw, flight and impact do
   * not advance); only the tick-scheduled spawn still runs, so the cadence
   * stays a pure function of the simulation tick.
   */
  const canHandleObjects = (fighter: Fighter): boolean =>
    !fighter.eliminated && fighter.koTimer === 0 && fighter.health > 0;
  /** Release held objects whose holder can no longer hold them. */
  const dropInvalidHeld = (): void => {
    for (const object of objects) {
      if (object.state !== 'held') continue;
      const holder = fighters.find(fighter => fighter.id === object.holder);
      if (!holder || !canHandleObjects(holder)) dropObject(object, holder);
    }
  };
  // Drop first: an object held by a fighter knocked out in the combat stage
  // must not stay attached or keep a spawn slot occupied.
  if (!frozen) dropInvalidHeld();
  // One bottle per 600 fighting ticks, at the next point in the fixed table,
  // while the unbroken cap has room. Both conditions are pure functions of the
  // tick and the state.
  if (next.tick > 0 && next.tick % OBJECT_SPAWN_TABLE.intervalTicks === 0 &&
      unbrokenCount(objects) < OBJECT_SPAWN_TABLE.maxUnbroken) {
    const spawnIndex = Math.floor(next.tick / OBJECT_SPAWN_TABLE.intervalTicks) - 1;
    const point = OBJECT_SPAWN_TABLE.points[spawnIndex % OBJECT_SPAWN_TABLE.points.length];
    objects.push({ id: nextObjectId(objects), kind: 'bottle', x: point.x, y: point.y, z: 0,
      state: 'ground', spawnTick: next.tick });
  }
  if (!frozen) {
    // Held objects follow their holder. A press while already holding is not
    // consumed by pickup; the throw stage below turns the same edge into a throw.
    for (const object of objects) {
      if (object.state !== 'held') continue;
      const holder = fighters.find(fighter => fighter.id === object.holder);
      if (!holder || !canHandleObjects(holder)) continue;
      object.x = holder.x;
      object.y = holder.y;
      object.z = HELD_OBJECT_Z;
    }
    const grabbedFighters = fighters.filter(fighter => grabPressed.has(fighter.id) && canHandleObjects(fighter))
      .sort((a, b) => a.id.localeCompare(b.id));
    const pickedUp = new Set<PlayerId>();
    for (const fighter of grabbedFighters) {
      if (objects.some(object => object.state === 'held' && object.holder === fighter.id)) continue;
      // The bottle must be in front of the fighter: the half-plane along
      // `facing`. A bottle exactly underfoot is allowed (dx * facing === 0).
      const candidates = objects.filter(object => object.state === 'ground' &&
        (object.x - fighter.x) * fighter.facing >= 0 &&
        Math.abs(object.x - fighter.x) <= OBJECT_PICKUP_REACH_X &&
        Math.abs(object.y - fighter.y) <= OBJECT_PICKUP_REACH_Y);
      candidates.sort((a, b) =>
        (Math.abs(a.x - fighter.x) + Math.abs(a.y - fighter.y)) -
        (Math.abs(b.x - fighter.x) + Math.abs(b.y - fighter.y)) ||
        objectNumber(a.id) - objectNumber(b.id));
      const target = candidates[0];
      if (!target) continue;
      target.state = 'held';
      target.holder = fighter.id;
      target.z = HELD_OBJECT_Z;
      delete target.vx;
      delete target.vz;
      pickedUp.add(fighter.id);
    }
    // Throw: the same grab edge, but only for a fighter that was already holding
    // at the start of this stage (not one that just picked a bottle up).
    for (const fighter of grabbedFighters) {
      if (pickedUp.has(fighter.id)) continue;
      const held = objects.find(object => object.state === 'held' && object.holder === fighter.id);
      if (!held) continue;
      held.state = 'airborne';
      held.x = fighter.x;
      held.y = fighter.y;
      held.z = THROW_START_Z;
      held.vx = fighter.facing * THROW_SPEED_X;
      held.vz = THROW_START_VZ;
    }
    // Flight: advance every airborne object exactly once. Held objects already
    // followed their holder; ground and broken objects do not move.
    for (const object of objects) {
      if (object.state !== 'airborne') continue;
      object.x += object.vx ?? 0;
      object.z += object.vz ?? 0;
      object.vz = (object.vz ?? 0) - OBJECT_GRAVITY;
    }
    // Impact: a thrown bottle breaks on the first opposing fighter in range, or
    // on the ground/arena edge. Impacts are resolved in object-id order so the
    // event stream is replay-stable.
    const airborne = objects.filter(object => object.state === 'airborne')
      .sort((a, b) => objectNumber(a.id) - objectNumber(b.id));
    for (const object of airborne) {
      const thrower = fighters.find(fighter => fighter.id === object.holder);
      const targets = fighters.filter(fighter => fighter.id !== object.holder && canHandleObjects(fighter) &&
        !fighter.protection && !sameTeam(thrower, fighter) &&
        Math.abs(fighter.x - object.x) <= THROW_HIT_RADIUS &&
        Math.abs(fighter.y - object.y) <= THROW_HIT_RADIUS &&
        Math.abs(fighter.z - object.z) <= THROW_HIT_HEIGHT);
      targets.sort((a, b) =>
        (Math.abs(a.x - object.x) + Math.abs(a.y - object.y)) -
        (Math.abs(b.x - object.x) + Math.abs(b.y - object.y)) ||
        a.id.localeCompare(b.id));
      const target = targets[0];
      if (target) {
        if (thrower) applyHit(thrower, target, 'throw', (object.vx ?? THROW_SPEED_X) < 0 ? -1 : 1);
        object.state = 'broken';
        delete object.holder;
        delete object.vx;
        delete object.vz;
        continue;
      }
      if (object.z <= 0 || object.x < ARENA_BOUNDS.minX || object.x > ARENA_BOUNDS.maxX) {
        object.x = clampX(object.x);
        object.z = 0;
        object.state = 'broken';
        delete object.holder;
        delete object.vx;
        delete object.vz;
      }
    }
    // An impact can knock out a holder after the pickup pass; release in cleanup
    // so no snapshot shows a KO'd fighter holding a bottle.
    dropInvalidHeld();
    // Cleanup: a broken bottle is gone before the snapshot is taken, so the
    // unbroken cap and the wire payload are bounded by OBJECT_SPAWN_TABLE.maxUnbroken.
    for (let index = objects.length - 1; index >= 0; index--) {
      if (objects[index].state === 'broken') objects.splice(index, 1);
    }
  }
  if (objects.length) next.objects = objects;
  else delete next.objects;
  if (rules.fragScoring) {
    // A fighter knocked out on the same tick credits no frag: mutual and
    // multi-fighter simultaneous KOs are draws in the frag table.
    const knockedOut = new Set(knockouts.map(k => k.target));
    const byFighterId = new Map(fighters.map(f => [f.id, f]));
    for (const ko of knockouts) {
      if (ko.attacker === ko.target || knockedOut.has(ko.attacker)) continue;
      const attacker = byFighterId.get(ko.attacker);
      if (attacker) attacker.frags = (attacker.frags ?? 0) + 1;
    }
  }
  if (rules.shrinkingZone && isZoneDamageTick(next.tick)) {
    // Ordering is deliberate: all combat damage, knockouts and frag credit above
    // resolve first. A fighter knocked out by combat this tick has a `koTimer`
    // and is skipped here, so a knockout shared by combat and the zone belongs
    // to the attacker. The zone cannot revoke a frag credited on this tick.
    const { minX, maxX } = zoneRangeAt(next.tick);
    for (const f of fighters) {
      if (f.eliminated || f.koTimer > 0) continue;
      if (f.x >= minX && f.x <= maxX) continue;
      f.health = Math.max(0, f.health - ZONE_DAMAGE_HP);
      if (f.health > 0) continue;
      // The zone is not a player: no attacker, no KO count and no frag. The
      // wire `Knockout` event requires a roster attacker and the zone must not
      // borrow a player id, so a zone death is carried by `deaths`/`koTimer`.
      knockOut(f);
      // A death still reads: extend an active hit stop to the KO length.
      next.hitStopTicks = Math.max(next.hitStopTicks ?? 0, KO_HIT_STOP_TICKS);
    }
  }
  if (wave) {
    const progress = next.wave;
    if (!progress) throw new Error('Wave mode state is missing wave progress');
    const enemySlots = fighters.reduce((count, f) => count + (f.team === wave.enemyTeam ? 1 : 0), 0);
    // A between-wave countdown is a match timer: it advances with the tick even
    // during hit stop, like the match clock and KO timers.
    if (progress.countdownTicks > 0) {
      progress.countdownTicks--;
      if (progress.countdownTicks === 0) {
        // Start the next wave: revive the active enemy slots at their original
        // spawn points, in stable roster order, with the normal respawn
        // protection so a wave cannot be spawn-camped.
        const active = waveEnemyCount(wave, progress.index, enemySlots);
        let seen = 0;
        for (const f of fighters) {
          if (f.team !== wave.enemyTeam) continue;
          if (seen++ >= active) continue;
          const point = spawn(fighters.indexOf(f), fighters.length);
          f.x = point.x; f.y = point.y; f.z = 0; f.vz = 0;
          f.health = 100; f.protection = 90; f.hitstun = 0; f.koTimer = 0;
          f.attackMove = null; f.attackFrames = 0;
          delete f.knockback;
          delete f.eliminated;
          event('Respawned', { target: f.id });
        }
      }
    }
    // `remaining` is derived from the fighter list, never incremented by hand,
    // so combat knockouts and inactive slots cannot drift from the counter.
    progress.remaining = fighters.reduce((count, f) =>
      count + (f.team === wave.enemyTeam && !f.eliminated ? 1 : 0), 0);
    if (progress.remaining === 0 && progress.countdownTicks === 0) {
      progress.index++;
      if (progress.index >= wave.count) {
        // A clear on the tick the timer would also expire ends the match as
        // `waves-cleared`: the clear happened in combat before timers advanced.
        finish('waves-cleared', modeWinner(fighters, rules));
        return next;
      }
      progress.countdownTicks = wave.countdownTicks;
    }
  }
  next.remainingTicks--;
  if (rules.respawn === 'eliminate' && aliveCount(fighters) <= 1) {
    finish('elimination', fighters.find(f => !f.eliminated)?.id ?? null);
    return next;
  }
  const fragLimit = rules.fragLimit;
  if (fragLimit !== null && fighters.some(f => (f.frags ?? 0) >= fragLimit)) {
    finish('frag-limit', modeWinner(fighters, rules));
    return next;
  }
  if (next.remainingTicks === 0) {
    finish('time', rules.id === 'score-brawl' ? null : modeWinner(fighters, rules));
  }
  return next;
}
