import type { PlayerInput } from '../simulation/types';

/** Strictly bounded, transport-neutral authoritative input assembly.
 * An adapter must authenticate connection identity and check slot ownership
 * before calling submit. This class does not establish authentication.
 */
export class SessionInputBuffer {
  private readonly pending = new Map<number, Map<string, PlayerInput>>();
  private readonly sequences = new Map<string, number>();
  private nextTick: number;

  constructor(startTick = 0, private readonly maxLead = 8, private readonly maxPlayers = 4) {
    if (![startTick, maxLead, maxPlayers].every(Number.isSafeInteger) ||
      startTick < 0 || startTick > Number.MAX_SAFE_INTEGER - maxLead - 1 ||
      maxLead < 0 || maxLead > 120 || maxPlayers < 1 || maxPlayers > 4) {
      throw new Error('Invalid input buffer configuration');
    }
    this.nextTick = startTick;
  }

  /** First valid input wins per player/tick. Sequence is monotonic per connection. */
  submit(connectionId: string, sequence: number, targetTick: number, input: PlayerInput): void {
    if (typeof connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(connectionId) || !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isSafeInteger(targetTick) || targetTick < this.nextTick ||
      targetTick - this.nextTick > this.maxLead) throw new Error('Stale, future or malformed input');
    if (!input || typeof input.playerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.playerId) ||
      ![-1, 0, 1].includes(input.moveX) || ![-1, 0, 1].includes(input.moveY) ||
      typeof input.jump !== 'boolean' ||
      !['punch', 'kick', 'jumpkick', 'attack'].every(k =>
        input[k as keyof PlayerInput] === undefined || typeof input[k as keyof PlayerInput] === 'boolean') ||
      Object.keys(input).some(k => !['playerId', 'moveX', 'moveY', 'jump', 'punch', 'kick', 'jumpkick', 'attack'].includes(k))) {
      throw new Error('Malformed player controls');
    }
    const previous = this.sequences.get(connectionId);
    if (previous !== undefined && sequence <= previous) throw new Error('Replayed input sequence');
    const tickInputs = this.pending.get(targetTick) ?? new Map<string, PlayerInput>();
    if (!tickInputs.has(input.playerId) && tickInputs.size >= this.maxPlayers) throw new Error('Tick roster full');
    // A duplicate submission cannot override a previously accepted input.
    if (tickInputs.has(input.playerId)) throw new Error('Duplicate player input');
    tickInputs.set(input.playerId, { ...input });
    this.pending.set(targetTick, tickInputs);
    this.sequences.set(connectionId, sequence);
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
}
