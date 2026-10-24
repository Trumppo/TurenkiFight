export type Direction = -1 | 1;
export type PlayerId = string;
export type PlayerInput = {
  playerId: PlayerId;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  jump: boolean;
  attack: boolean;
};
export type Fighter = {
  id: PlayerId;
  x: number;
  y: number;
  z: number;
  vz: number;
  facing: Direction;
  health: number;
  score: number;
  attackCooldown: number;
  attackFrames: number;
  hitTargets: string[];
};
export type GameState = {
  tick: number;
  fighters: Fighter[];
};
