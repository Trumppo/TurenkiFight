import type { Fighter, GameState, PlayerInput, Move, GameEvent, ModeId, EndReason, PlayerId } from './types';
import { aliveCount, modeRules, modeWinner } from './modes';
import { isZoneDamageTick, zoneRangeAt, ZONE_DAMAGE_HP } from './zone';
export { MATCH_TICKS } from './modes';
export { MODE_RULES, aliveCount, compareTieBreak, modeMetric, modeRules, modeWinner } from './modes';
export type { EndReason, ModeId, ModeRules, RespawnPolicy, TieBreakCriterion } from './types';
export type MatchSetup = { ids?: string[]; phase?: GameState['phase']; mode?: ModeId };
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
};
function spawn(index: number, count: number): { x: number; y: number } {
  return { x: 70 + (244 * index) / Math.max(1, count - 1), y: 148 + (index % 2) * 35 };
}
/**
 * Match creation accepts either the historical positional form
 * (`createState(ids, phase)`) or a setup object (`createState({ mode })`).
 * Score Brawl is the default and omits `mode` from the state so existing
 * snapshots and pinned fingerprints remain byte-identical.
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
  const extras: Partial<Fighter> = {};
  if (rules.fragScoring) extras.frags = 0;
  if (rules.trackDeaths) extras.deaths = 0;
  if (rules.trackDamage) extras.damageDealt = 0;
  if (rules.respawn === 'eliminate') extras.eliminated = false;
  return { tick: 0, phase, countdownTicks: COUNTDOWN_TICKS, remainingTicks: rules.timerTicks, events: [],
    ...(mode ? { mode } : {}),
    fighters: ids.map((id, i) => ({ id, ...spawn(i, ids.length), z: 0, vz: 0, facing: (i % 2 ? -1 : 1) as -1 | 1,
      health: 100, score: 0, koCount: 0, hitsReceived: 0, attackCooldown: 0, attackFrames: 0, attackMove: null,
      hitTargets: [], hitstun: 0, koTimer: 0, protection: 0, previousButtons: [], ...extras })) };
}
export function standings(state: GameState): { id: string; rank: number; score: number }[] {
  const sorted = [...state.fighters].sort((a,b) => b.score-a.score || b.koCount-a.koCount || a.hitsReceived-b.hitsReceived || a.id.localeCompare(b.id));
  return sorted.map((f,i) => ({ id: f.id, score: f.score, rank: 1 + sorted.slice(0,i).filter(p => p.score > f.score || (p.score === f.score && (p.koCount > f.koCount || (p.koCount === f.koCount && p.hitsReceived < f.hitsReceived)))).length }));
}
export function step(state: GameState, inputs: PlayerInput[]): GameState {
  const rules = modeRules(state.mode);
  const fighters = state.fighters.map(f => ({ ...f, hitTargets: [...f.hitTargets], previousButtons: [...f.previousButtons] }));
  const next: GameState = { ...state, tick: state.tick + 1, fighters, events: [] };
  const event = (type: GameEvent['type'], extra: Partial<GameEvent> = {}) => next.events.push({ tick: next.tick, type, ...extra });
  const finish = (reason: EndReason, winner: PlayerId | null) => {
    next.phase = 'results';
    switch (rules.id) {
      case 'score-brawl':
        // Historical lifecycle event shape: no reason/winner for Score Brawl.
        event('MatchEnded');
        break;
      case 'last-man-standing':
      case 'deathmatch':
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
    if (rules.respawn === 'eliminate') {
      target.eliminated = true;
    } else {
      target.koTimer = 180;
      if (rules.trackDeaths) target.deaths = (target.deaths ?? 0) + 1;
    }
  };
  if (state.phase === 'results' || state.phase === 'lobby') return next;
  if (state.phase === 'countdown') {
    next.countdownTicks = Math.max(0, state.countdownTicks - 1);
    if (!next.countdownTicks) { next.phase = 'fighting'; event('MatchStarted'); }
    return next;
  }
  const byId = new Map(inputs.map(i => [i.playerId, i]));
  for (const f of fighters) {
    // An eliminated fighter is out: no movement, attacks, edge detection or respawn.
    if (f.eliminated) continue;
    const i = byId.get(f.id);
    const buttons: string[] = i ? [...(['punch','kick','jumpkick'] as Move[]).filter(m => i[m] || (m === 'punch' && i.attack)), ...(i.jump ? ['jump'] : [])] : [];
    const pressed = buttons.filter(b => !f.previousButtons.includes(b));
    const jumpPressed = buttons.includes('jump') && !f.previousButtons.includes('jump');
    f.previousButtons = buttons;
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
          f.x = s.x; f.y = s.y; f.z = 0; f.vz = 0; f.health = 100; f.protection = 90; event('Respawned', { target: f.id });
        } else {
          f.eliminated = true; f.health = 0; f.attackMove = null; f.attackFrames = 0; f.hitstun = 0;
        }
      }
      continue;
    }
    if (f.protection > 0) f.protection--;
    const stunned = f.hitstun > 0;
    if (f.hitstun > 0) f.hitstun--;
    if (f.attackFrames > 0) { f.attackFrames--; if (!f.attackFrames) f.attackMove=null; }
    f.attackCooldown = f.attackFrames;
    if (i && !stunned) {
      const scale = i.moveX && i.moveY ? Math.SQRT1_2 : 1;
      f.x = Math.max(16,Math.min(368,f.x + i.moveX * FIGHTER_SPEED * scale));
      f.y = Math.max(124,Math.min(204,f.y + i.moveY * FIGHTER_SPEED * scale));
      if (i.moveX) f.facing = i.moveX;
      if (jumpPressed && f.z === 0 && !f.attackMove) f.vz = 5.2;
      if (!f.attackMove) {
        const move = (pressed.filter(m => m !== 'jump') as Move[]).find(m => m === 'jumpkick' ? f.z > 0 : f.z === 0);
        if (move) { f.attackMove=move; const d=MOVES[move]; f.attackFrames=d.startup+d.active+d.recovery; f.attackCooldown=f.attackFrames; f.hitTargets=[]; f.protection=0; }
      }
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
      const dx=(t.x-a.x)*a.facing;
      if (dx > 0 && dx <= m.reach && Math.abs(t.y-a.y) <= m.depth && Math.abs(t.z-a.z) <= m.height) hits.push({attacker:a,target:t,move:a.attackMove});
    }
  }
  hits.sort((a,b)=>a.attacker.id.localeCompare(b.attacker.id)||a.target.id.localeCompare(b.target.id));
  const knockouts: { attacker: PlayerId; target: PlayerId }[] = [];
  for (const h of hits) {
    const {attacker:a,target:t,move}=h;
    // Eligibility was captured before resolution: a fighter KO'd by an earlier
    // sorted hit can still land a simultaneous attack in this same tick.
    if (a.hitTargets.includes(t.id)) continue;
    // Eliminated fighters are no longer valid targets, even later in the same tick.
    if (t.eliminated) continue;
    a.hitTargets.push(t.id);
    const m=MOVES[move];
    if (rules.hitScoring) a.score+=m.points;
    if (rules.trackDamage) a.damageDealt = (a.damageDealt ?? 0) + m.damage;
    t.hitsReceived++; t.health=Math.max(0,t.health-m.damage);
    event('HitLanded',{attacker:a.id,target:t.id,move});
    if (t.health === 0 && !t.koTimer) {
      if (rules.koScoring) { a.score+=500; t.score-=200; }
      a.koCount++;
      event('Knockout',{attacker:a.id,target:t.id});
      knockOut(t);
      if (rules.fragScoring) knockouts.push({ attacker: a.id, target: t.id });
    }
    else if (!t.koTimer) t.hitstun=Math.max(t.hitstun,8);
  }
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
