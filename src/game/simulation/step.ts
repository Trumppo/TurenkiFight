import type { Fighter, GameState, PlayerInput, Move, GameEvent } from './types';
export const TICK_RATE = 60;
export const MATCH_TICKS = 7200;
export const COUNTDOWN_TICKS = 180;
export const MOVES: Record<Move, { startup: number; active: number; recovery: number; damage: number; points: number; reach: number; depth: number; height: number }> = {
  punch: { startup: 4, active: 5, recovery: 12, damage: 10, points: 100, reach: 32, depth: 14, height: 18 },
  kick: { startup: 7, active: 6, recovery: 16, damage: 15, points: 150, reach: 42, depth: 17, height: 20 },
  jumpkick: { startup: 6, active: 7, recovery: 18, damage: 20, points: 200, reach: 45, depth: 19, height: 30 },
};
function spawn(index: number, count: number): { x: number; y: number } {
  return { x: 70 + (244 * index) / Math.max(1, count - 1), y: 148 + (index % 2) * 35 };
}
export function createState(ids: string[] = ['P1', 'P2'], phase: GameState['phase'] = 'countdown'): GameState {
  if (ids.length < 1 || new Set(ids).size !== ids.length) throw new Error('Roster must contain unique players');
  return { tick: 0, phase, countdownTicks: COUNTDOWN_TICKS, remainingTicks: MATCH_TICKS, events: [],
    fighters: ids.map((id, i) => ({ id, ...spawn(i, ids.length), z: 0, vz: 0, facing: (i % 2 ? -1 : 1) as -1 | 1,
      health: 100, score: 0, koCount: 0, hitsReceived: 0, attackCooldown: 0, attackFrames: 0, attackMove: null,
      hitTargets: [], hitstun: 0, koTimer: 0, protection: 0, previousButtons: [] })) };
}
export function standings(state: GameState): { id: string; rank: number; score: number }[] {
  const sorted = [...state.fighters].sort((a,b) => b.score-a.score || b.koCount-a.koCount || a.hitsReceived-b.hitsReceived || a.id.localeCompare(b.id));
  return sorted.map((f,i) => ({ id: f.id, score: f.score, rank: 1 + sorted.slice(0,i).filter(p => p.score > f.score || (p.score === f.score && (p.koCount > f.koCount || (p.koCount === f.koCount && p.hitsReceived < f.hitsReceived)))).length }));
}
export function step(state: GameState, inputs: PlayerInput[]): GameState {
  const fighters = state.fighters.map(f => ({ ...f, hitTargets: [...f.hitTargets], previousButtons: [...f.previousButtons] }));
  const next: GameState = { ...state, tick: state.tick + 1, fighters, events: [] };
  const event = (type: GameEvent['type'], extra: Partial<GameEvent> = {}) => next.events.push({ tick: next.tick, type, ...extra });
  if (state.phase === 'results' || state.phase === 'lobby') return next;
  if (state.phase === 'countdown') {
    next.countdownTicks = Math.max(0, state.countdownTicks - 1);
    if (!next.countdownTicks) { next.phase = 'fighting'; event('MatchStarted'); }
    return next;
  }
  const byId = new Map(inputs.map(i => [i.playerId, i]));
  for (const f of fighters) {
    const i = byId.get(f.id);
    const buttons: string[] = i ? [...(['punch','kick','jumpkick'] as Move[]).filter(m => i[m] || (m === 'punch' && i.attack)), ...(i.jump ? ['jump'] : [])] : [];
    const pressed = buttons.filter(b => !f.previousButtons.includes(b));
    const jumpPressed = buttons.includes('jump') && !f.previousButtons.includes('jump');
    f.previousButtons = buttons;
    if (f.koTimer > 0) {
      f.koTimer--;
      if (!f.koTimer) { const origin = spawn(fighters.indexOf(f), fighters.length); const options = [origin, ...Array.from({length:8},(_,i)=>({x:Math.max(16,Math.min(368,origin.x+(i%2?1:-1)*(Math.floor(i/2)+1)*32)),y:origin.y}))]; const s = options.find(p=>fighters.every(other=>other.id===f.id || other.koTimer>0 || Math.hypot(other.x-p.x,other.y-p.y)>=24)) ?? origin; f.x=s.x; f.y=s.y; f.z=0; f.vz=0; f.health=100; f.protection=90; event('Respawned',{target:f.id}); }
      continue;
    }
    if (f.protection > 0) f.protection--;
    const stunned = f.hitstun > 0;
    if (f.hitstun > 0) f.hitstun--;
    if (f.attackFrames > 0) { f.attackFrames--; if (!f.attackFrames) f.attackMove=null; }
    f.attackCooldown = f.attackFrames;
    if (i && !stunned) {
      const scale = i.moveX && i.moveY ? Math.SQRT1_2 : 1;
      f.x = Math.max(16,Math.min(368,f.x + i.moveX * 1.3 * scale));
      f.y = Math.max(124,Math.min(204,f.y + i.moveY * 1.3 * scale));
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
    if (!a.attackMove || a.koTimer) continue;
    const m=MOVES[a.attackMove], elapsed=m.startup+m.active+m.recovery-a.attackFrames;
    if (elapsed < m.startup || elapsed >= m.startup+m.active) continue;
    for (const t of fighters) {
      if (a.id === t.id || t.koTimer || t.protection || a.hitTargets.includes(t.id)) continue;
      const dx=(t.x-a.x)*a.facing;
      if (dx > 0 && dx <= m.reach && Math.abs(t.y-a.y) <= m.depth && Math.abs(t.z-a.z) <= m.height) hits.push({attacker:a,target:t,move:a.attackMove});
    }
  }
  hits.sort((a,b)=>a.attacker.id.localeCompare(b.attacker.id)||a.target.id.localeCompare(b.target.id));
  for (const h of hits) {
    const {attacker:a,target:t,move}=h;
    if (a.hitTargets.includes(t.id) || t.koTimer) continue;
    a.hitTargets.push(t.id);
    const m=MOVES[move]; a.score+=m.points; t.hitsReceived++; t.health=Math.max(0,t.health-m.damage);
    event('HitLanded',{attacker:a.id,target:t.id,move});
    if (t.health === 0 && !t.koTimer) { a.score+=500; a.koCount++; t.score-=200; t.koTimer=180; t.attackMove=null; t.attackFrames=0; t.hitstun=0; event('Knockout',{attacker:a.id,target:t.id}); }
    else if (!t.koTimer) t.hitstun=Math.max(t.hitstun,8);
  }
  next.remainingTicks--;
  if (next.remainingTicks === 0) { next.phase='results'; event('MatchEnded'); }
  return next;
}
