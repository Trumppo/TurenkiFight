import type { PlayerInput } from '../simulation/types';
import { MAX_PLAYERS } from '../protocol/players';
import { SessionRoster } from './sessionRoster';
import { DEFAULT_MAX_INPUT_LEAD_TICKS, SessionInputBuffer } from './sessionInputBuffer';

/**
 * The only intended network-facing entry point for simulation controls.
 * Transport supplies a trusted connection ID (not a client payload field).
 * The roster verifies ownership before the buffer sees any control.
 *
 * Session authentication, transport encryption and network serialization
 * are outside this module. A disconnected connection must be revoked here.
 */
export class AuthorizedSessionIngress {
  private readonly roster: SessionRoster;
  private readonly buffer: SessionInputBuffer;

  constructor(startTick = 0, maxLead = DEFAULT_MAX_INPUT_LEAD_TICKS, maxPlayers = MAX_PLAYERS) {
    this.roster = new SessionRoster(maxPlayers);
    this.buffer = new SessionInputBuffer(startTick, maxLead, maxPlayers);
  }

  join(connectionId: string, playerId: string): void {
    this.roster.join(connectionId, playerId);
  }

  /** Claims every slot owned by one connection as a single authorization step. */
  joinMany(connectionId: string, playerIds: readonly string[]): void {
    this.roster.joinMany(connectionId, playerIds);
  }

  owns(connectionId: string, playerId: string): boolean {
    return this.roster.owns(connectionId, playerId);
  }

  hasConnection(connectionId: string): boolean {
    return this.roster.hasConnection(connectionId);
  }

  assertHost(connectionId: string): void {
    this.roster.assertHost(connectionId);
  }

  submit(connectionId: string, sequence: number, targetTick: number, input: PlayerInput): void {
    // Fail closed without changing sequence state or tick queue on denial.
    if (!input || typeof input.playerId !== 'string') throw new Error('Malformed player input');
    this.roster.assertOwns(connectionId, input.playerId);
    this.buffer.submit(connectionId, sequence, targetTick, input);
  }

  /** Atomically submits every claimed slot; denial cannot partially apply. */
  submitFrame(connectionId: string, sequence: number, targetTick: number, inputs: readonly PlayerInput[]): void {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Malformed player input');
    for (const input of inputs) {
      if (!input || typeof input.playerId !== 'string') throw new Error('Malformed player input');
      this.roster.assertOwns(connectionId, input.playerId);
    }
    this.buffer.submitFrame(connectionId, sequence, targetTick, inputs);
  }

  consume(): { version: 1; tick: number; inputs: PlayerInput[] } {
    return this.buffer.consume();
  }

  disconnect(connectionId: string): string[] {
    const revoked = this.roster.disconnect(connectionId);
    for (const playerId of revoked) this.buffer.revokePlayer(playerId);
    this.buffer.revokeConnection(connectionId);
    return revoked;
  }

  get playerCount(): number {
    return this.roster.playerCount;
  }

  get bufferedTicks(): number {
    return this.buffer.bufferedTicks;
  }

  get nextTick(): number {
    return this.buffer.nextTickValue;
  }

  get maxLeadTicks(): number {
    return this.buffer.maxLeadTicks;
  }

  get playerCapacity(): number {
    return this.buffer.playerCapacity;
  }
}
