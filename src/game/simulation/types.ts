export type Direction = -1 | 1;
export type PlayerId = string;
export type Move = 'punch' | 'kick' | 'jumpkick';
export type Phase = 'lobby' | 'countdown' | 'fighting' | 'results';
export type PlayerInput = { playerId: PlayerId; moveX: -1 | 0 | 1; moveY: -1 | 0 | 1; jump: boolean; punch?: boolean; kick?: boolean; jumpkick?: boolean; attack?: boolean };
export type Fighter = { id: PlayerId; x: number; y: number; z: number; vz: number; facing: Direction; health: number; score: number; koCount: number; hitsReceived: number; attackCooldown: number; attackFrames: number; attackMove: Move | null; hitTargets: string[]; hitstun: number; koTimer: number; protection: number; previousButtons: string[] };
export type GameEvent = { tick: number; type: 'HitLanded' | 'Knockout' | 'Respawned' | 'MatchStarted' | 'MatchEnded'; attacker?: PlayerId; target?: PlayerId; move?: Move };
export type GameState = { tick: number; fighters: Fighter[]; phase: Phase; countdownTicks: number; remainingTicks: number; events: GameEvent[] };
