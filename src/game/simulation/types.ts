export type Direction = -1 | 1;
export type PlayerId = string;
/** `throw` is a projectile hit, not a fighter attack; `MOVES.throw` carries only hit values. */
export type Move = 'punch' | 'kick' | 'jumpkick' | 'throw';
/** The first playable object type. More kinds stay out of the M12 first slice. */
export type ObjectKind = 'bottle';
export type ObjectState = 'ground' | 'held' | 'airborne' | 'broken';
/**
 * Deterministic non-fighter entity. `id` is stable while the object exists
 * (`O1`, `O2`, ...). `holder` is present while the object is held or in flight
 * (the thrower keeps attribution). Airborne objects persist their velocity so a
 * snapshot restores the exact arc without recomputing it.
 */
export type SimObject = {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  z: number;
  state: ObjectState;
  holder?: PlayerId;
  /** Simulation tick the object entered the arena. */
  spawnTick?: number;
  /** Airborne only: horizontal px per tick, signed. */
  vx?: number;
  /** Airborne only: vertical px per tick. */
  vz?: number;
};
export type Phase = 'lobby' | 'countdown' | 'fighting' | 'results';
/**
 * Optional combat side. Absent means free-for-all: the historical modes never
 * set it, so their snapshots stay byte-identical. With a team set, attacks and
 * thrown objects never damage or target a teammate (ADR 0005).
 */
export type Team = 'players' | 'enemies';
/** Match rules are selected once at match creation, never per input frame. */
export type ModeId = 'score-brawl' | 'last-man-standing' | 'deathmatch' | 'wave';
export type EndReason = 'elimination' | 'frag-limit' | 'time' | 'waves-cleared';
/**
 * Co-op wave progress (ADR 0005). `index` counts cleared waves, so the wave
 * being fought is `index + 1`. `countdownTicks` runs only between waves, and
 * `remaining` counts the live enemies of the current wave. Present only in
 * `wave` mode and canonically omitted everywhere else.
 */
export type WaveState = { index: number; countdownTicks: number; remaining: number };
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
  /**
   * Enables the shrinking safe platform from `zone.ts`: outside damage and
   * spawn clamping. Only Deathmatch sets this, so Score Brawl and Last Man
   * Standing keep their byte-identical historical behaviour.
   */
  shrinkingZone: boolean;
  /**
   * Wave lifecycle settings, present only for `wave` mode. Kept on the rules
   * table so the tick loop reads data instead of branching on a mode id.
   */
  wave: WaveRules | null;
};
/**
 * First-slice wave configuration. `count` waves are cleared, a later wave
 * starts after `countdownTicks` fighting ticks, and each wave activates one
 * more enemy slot than the previous one up to the roster (same stats).
 */
export type WaveRules = {
  count: number;
  countdownTicks: number;
  /** Enemy slots active in wave 1; every later wave adds one. */
  firstWaveEnemies: number;
  /** Fighters on this team are knocked out of the wave instead of respawning. */
  enemyTeam: Team;
  /** Only attacks from this team write score, as Score Brawl does. */
  scoringTeam: Team;
};
export type PlayerInput = { playerId: PlayerId; moveX: -1 | 0 | 1; moveY: -1 | 0 | 1; jump: boolean; punch?: boolean; kick?: boolean; jumpkick?: boolean; attack?: boolean; /** Pick up a nearby ground object, or throw the held one. */ grab?: boolean };
/**
 * Mode-specific fields are optional so a Score Brawl fighter keeps its exact
 * historical JSON shape. Last Man Standing adds `eliminated`/`damageDealt`;
 * Deathmatch adds `frags`/`deaths`/`damageDealt`; wave mode adds `team` and
 * uses `eliminated` for enemies knocked out of the current wave.
 */
export type Fighter = { id: PlayerId; x: number; y: number; z: number; vz: number; facing: Direction; health: number; score: number; koCount: number; hitsReceived: number; attackCooldown: number; attackFrames: number; attackMove: Move | null; hitTargets: string[]; hitstun: number; /** Signed px still to slide from the last hit. Absent means 0 and is omitted from the wire. */ knockback?: number; koTimer: number; protection: number; previousButtons: string[]; eliminated?: boolean; frags?: number; deaths?: number; damageDealt?: number; /** Optional combat side; absent means free-for-all. */ team?: Team };
export type GameEvent = { tick: number; type: 'HitLanded' | 'Knockout' | 'Respawned' | 'MatchStarted' | 'MatchEnded'; attacker?: PlayerId; target?: PlayerId; move?: Move; reason?: EndReason; winner?: PlayerId | null };
/**
 * `hitStopTicks` is the deterministic freeze counter from `step.ts`: a clean
 * hit sets 3, a knockout 5, and the counter counts down once per fighting tick.
 * It is optional: absent means 0 and it is omitted from the wire when idle.
 * `mode` is absent for Score Brawl; it is present only for the newer
 * rules-driven modes.
 */
export type GameState = { tick: number; fighters: Fighter[]; /** Present only while at least one object exists; canonically omitted when empty. */ objects?: SimObject[]; phase: Phase; countdownTicks: number; remainingTicks: number; hitStopTicks?: number; events: GameEvent[]; mode?: ModeId; /** Present only in wave mode; canonically omitted everywhere else. */ wave?: WaveState };
