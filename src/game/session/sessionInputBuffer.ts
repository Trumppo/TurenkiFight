import type { PlayerInput } from '../simulation/types';
import { MAX_PLAYERS } from '../protocol/players';

/** Default input look-ahead, shared by every session ingress boundary. */
export const DEFAULT_MAX_INPUT_LEAD_TICKS = 8;
export const MAX_INPUT_LEAD_TICKS = 120;
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Strictly bounded, transport-neutral authoritative input assembly.
 * An adapter must authenticate connection identity and check slot ownership
 * before calling submit. This class does not establish authentication.
 */
export class SessionInputBuffer {
  private readonly pending = new Map<number, Map<string, PlayerInput>>();
  private readonly sequences = new Map<string, number>();
  private nextTick: number;

  constructor(
    startTick = 0,
    private readonly maxLead = DEFAULT_MAX_INPUT_LEAD_TICKS,
    private readonly maxPlayers = MAX_PLAYERS,
  ) {
    if (![startTick, maxLead, maxPlayers].every(Number.isSafeInteger) ||
      startTick < 0 || startTick > Number.MAX_SAFE_INTEGER - maxLead - 1 ||
      maxLead < 0 || maxLead > MAX_INPUT_LEAD_TICKS ||
      maxPlayers < 1 || maxPlayers > MAX_PLAYERS) {
      throw new Error('Invalid input buffer configuration');
    }
    this.nextTick = startTick;
  }

  /** First valid input wins per player/tick. Sequence is monotonic per connection. */
  submit(connectionId: string, sequence: number, targetTick: number, input: PlayerInput): void {
    this.submitFrame(connectionId, sequence, targetTick, [input]);
  }

  /**
   * Atomically submits every slot owned by one connection for one envelope.
   * All validations run before any mutation, so a denied frame leaves the
   * sequence domain and every pending tick exactly as they were.
   */
  submitFrame(connectionId: string, sequence: number, targetTick: number, inputs: readonly PlayerInput[]): void {
    if (typeof connectionId !== 'string' || !CONNECTION_ID.test(connectionId) || !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isSafeInteger(targetTick) || targetTick < this.nextTick ||
      targetTick - this.nextTick > this.maxLead) throw new Error('Stale, future or malformed input');
    if (sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Sequence counter exhausted; session reset required');
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > this.maxPlayers) throw new Error('Malformed player controls');
    const claimed = new Set<string>();
    for (const input of inputs) {
      this.assertControls(input);
      if (claimed.has(input.playerId)) throw new Error('Duplicate player input');
      claimed.add(input.playerId);
    }
    const previous = this.sequences.get(connectionId);
    if (previous !== undefined && sequence <= previous) throw new Error('Replayed input sequence');
    const existing = this.pending.get(targetTick);
    let additions = 0;
    for (const playerId of claimed) {
      // A duplicate submission cannot override a previously accepted input.
      if (existing?.has(playerId)) throw new Error('Duplicate player input');
      additions++;
    }
    if ((existing?.size ?? 0) + additions > this.maxPlayers) throw new Error('Tick roster full');
    const tickInputs = existing ?? new Map<string, PlayerInput>();
    for (const input of inputs) tickInputs.set(input.playerId, { ...input });
    this.pending.set(targetTick, tickInputs);
    this.sequences.set(connectionId, sequence);
  }

  private assertControls(input: PlayerInput): void {
    if (!input || typeof input.playerId !== 'string' || !CONNECTION_ID.test(input.playerId) ||
      ![-1, 0, 1].includes(input.moveX) || ![-1, 0, 1].includes(input.moveY) ||
      typeof input.jump !== 'boolean' ||
      !['punch', 'kick', 'jumpkick', 'attack', 'grab'].every(k =>
        input[k as keyof PlayerInput] === undefined || typeof input[k as keyof PlayerInput] === 'boolean') ||
      Object.keys(input).some(k => !['playerId', 'moveX', 'moveY', 'jump', 'punch', 'kick', 'jumpkick', 'attack', 'grab'].includes(k))) {
      throw new Error('Malformed player controls');
    }
  }

  /** Returns a canonical frame; absent players are neutralized by simulation. */
  consume(): { version: 1; tick: number; inputs: PlayerInput[] } {
    if (!Number.isSafeInteger(this.nextTick + 1)) throw new Error('Tick counter exhausted');
    const tick = this.nextTick++;
    const inputs = [...(this.pending.get(tick)?.values() ?? [])]
      .sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
    this.pending.delete(tick);
    return { version: 1, tick, inputs };
  }

  /**
   * Drop every queued frame without touching tick counters or sequence domains.
   * Used between matches: input submitted ahead of a finished match must not
   * leak into the next one, while the same connections keep their sequences.
   */
  discardPending(): void {
    this.pending.clear();
  }

  /** Immediately revoke queued controls for a disconnected slot. */
  revokePlayer(playerId: string): void {
    for (const [tick, inputs] of this.pending) {
      inputs.delete(playerId);
      if (inputs.size === 0) this.pending.delete(tick);
    }
  }

  /** Connection replacement starts a fresh sequence domain after authorization. */
  revokeConnection(connectionId: string): void {
    this.sequences.delete(connectionId);
  }

  get bufferedTicks(): number {
    return this.pending.size;
  }

  /** The next authoritative tick; late input is rejected against this value. */
  get nextTickValue(): number {
    return this.nextTick;
  }

  get maxLeadTicks(): number {
    return this.maxLead;
  }

  get playerCapacity(): number {
    return this.maxPlayers;
  }
}
