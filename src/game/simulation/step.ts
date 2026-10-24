import type { Fighter, GameState, PlayerInput } from './types';

export const TICK_RATE = 60;
const SPEED = 1.3;
const DEPTH_SPEED = 0.9;
const GRAVITY = 0.35;
const JUMP_SPEED = 5.2;
const ATTACK_COOLDOWN = 28;
const ATTACK_ACTIVE_FRAMES = 7;

export function createState(): GameState {
  return {
    tick: 0,
    fighters: [
      createFighter('P1', 95, 159, 1),
      createFighter('P2', 280, 180, -1),
    ],
  };
}

function createFighter(id: string, x: number, y: number, facing: -1 | 1): Fighter {
  return { id, x, y, z: 0, vz: 0, facing, health: 100, score: 0, attackCooldown: 0, attackFrames: 0, hitTargets: [] };
}

/** Pure-ish fixed-step transition: input state is never mutated. */
export function step(state: GameState, inputs: PlayerInput[]): GameState {
  const fighters = state.fighters.map(f => ({ ...f, hitTargets: [...f.hitTargets] }));
  const byId = new Map(inputs.map(input => [input.playerId, input]));

  for (const fighter of fighters) {
    const input = byId.get(fighter.id);
    if (input) {
      fighter.x = clamp(fighter.x + input.moveX * SPEED, 16, 368);
      fighter.y = clamp(fighter.y + input.moveY * DEPTH_SPEED, 124, 204);
      if (input.moveX !== 0) fighter.facing = input.moveX;
      if (input.jump && fighter.z === 0) fighter.vz = JUMP_SPEED;
      if (input.attack && fighter.attackCooldown === 0) {
        fighter.attackCooldown = ATTACK_COOLDOWN;
        fighter.attackFrames = ATTACK_ACTIVE_FRAMES;
        fighter.hitTargets = [];
      }
    }
    fighter.z = Math.max(0, fighter.z + fighter.vz);
    fighter.vz = fighter.z === 0 ? 0 : fighter.vz - GRAVITY;
    if (fighter.attackCooldown > 0) fighter.attackCooldown--;
  }

  for (const attacker of fighters) {
    if (attacker.attackFrames <= 0) continue;
    for (const target of fighters) {
      if (target.id === attacker.id || attacker.hitTargets.includes(target.id)) continue;
      const dx = (target.x - attacker.x) * attacker.facing;
      const dy = Math.abs(target.y - attacker.y);
      const dz = Math.abs(target.z - attacker.z);
      if (dx > 0 && dx < 32 && dy < 16 && dz < 20) {
        attacker.hitTargets.push(target.id);
        attacker.score += 100;
        target.health = Math.max(0, target.health - 10);
        if (target.health === 0) {
          attacker.score += 500;
          target.health = 100; // Placeholder instant respawn; mode rules will replace this.
          target.x = target.id === 'P1' ? 95 : 280;
          target.y = target.id === 'P1' ? 159 : 180;
        }
      }
    }
    attacker.attackFrames--;
  }

  return { tick: state.tick + 1, fighters };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
