export type Direction = -1 | 1;
export type PlayerId = string;
export type Move = 'punch' | 'kick' | 'jumpkick';
export type Phase = 'lobby' | 'countdown' | 'fighting' | 'results';
/** Match rules are selected once at match creation, never per input frame. */
export type ModeId = 'score-brawl' | 'last-man-standing' | 'deathmatch';
export type EndReason = 'elimination' | 'frag-limit' | 'time';
export type RespawnPolicy = 'respawn' | 'eliminate';
/** Ordered timer tie-break criteria. Lower is better only for `deaths` and `hitsReceived`. */
export type TieBreakCriterion = 'score' | 'health' | 'kos' | 'frags' | 'deaths' | 'damage' | 'hitsReceived';
export type ModeRules = {
  id: ModeId;
  /** Per-fighter stocks before elimination; null means unlimited respawns. */
  stocks: number | null;
  respawn: RespawnPolicy;
  fragLimit: number | null;
  timerTicks: number;
  tieBreak: readonly TieBreakCriterion[];
  /** Score Brawl scoring is the only mode that writes hit/KO score. */
  hitScoring: boolean;
  koScoring: boolean;
  fragScoring: boolean;
  trackDamage: boolean;
  trackDeaths: boolean;
};
export type PlayerInput = { playerId: PlayerId; moveX: -1 | 0 | 1; moveY: -1 | 0 | 1; jump: boolean; punch?: boolean; kick?: boolean; jumpkick?: boolean; attack?: boolean };
/**
 * Mode-specific fields are optional so a Score Brawl fighter keeps its exact
 * historical JSON shape. Last Man Standing adds `eliminated`/`damageDealt`;
 * Deathmatch adds `frags`/`deaths`/`damageDealt`.
 */
export type Fighter = { id: PlayerId; x: number; y: number; z: number; vz: number; facing: Direction; health: number; score: number; koCount: number; hitsReceived: number; attackCooldown: number; attackFrames: number; attackMove: Move | null; hitTargets: string[]; hitstun: number; koTimer: number; protection: number; previousButtons: string[]; eliminated?: boolean; frags?: number; deaths?: number; damageDealt?: number };
export type GameEvent = { tick: number; type: 'HitLanded' | 'Knockout' | 'Respawned' | 'MatchStarted' | 'MatchEnded'; attacker?: PlayerId; target?: PlayerId; move?: Move; reason?: EndReason; winner?: PlayerId | null };
/**
 * `mode` is absent for Score Brawl so its state and pinned fingerprints stay
 * byte-identical. It is present only for the newer rules-driven modes.
 */
export type GameState = { tick: number; fighters: Fighter[]; phase: Phase; countdownTicks: number; remainingTicks: number; events: GameEvent[]; mode?: ModeId };
