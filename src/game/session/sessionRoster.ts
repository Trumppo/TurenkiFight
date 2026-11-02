import { MAX_PLAYERS } from '../protocol/players';

/** Transport-independent room membership and player ownership.
 * No network, identity provider or simulation dependency. Connection IDs are
 * supplied by a trusted transport adapter, never read from untrusted payloads.
 */
export type SessionConnectionId = string;
export type SessionPlayerId = string;

export class SessionRoster {
  private readonly connections = new Map<SessionConnectionId, Set<SessionPlayerId>>();
  private readonly owners = new Map<SessionPlayerId, SessionConnectionId>();
  private host: SessionConnectionId | null = null;
  private hostAssigned = false;

  constructor(private readonly maxPlayers = MAX_PLAYERS) {
    if (!Number.isSafeInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS) {
      throw new Error('Invalid player capacity');
    }
  }

  join(connectionId: SessionConnectionId, playerId: SessionPlayerId): void {
    this.joinMany(connectionId, [playerId]);
  }

  /**
   * Claims several slots for one connection atomically. Every claim is checked
   * before any ownership changes, so a partially authorized join cannot exist.
   */
  joinMany(connectionId: SessionConnectionId, playerIds: readonly SessionPlayerId[]): void {
    this.assertId(connectionId);
    if (!Array.isArray(playerIds) || playerIds.length < 1) throw new Error('Invalid player slots');
    const claimed = new Set<SessionPlayerId>();
    let additions = 0;
    for (const playerId of playerIds) {
      this.assertId(playerId);
      if (claimed.has(playerId)) throw new Error('Duplicate player slot');
      claimed.add(playerId);
      const currentOwner = this.owners.get(playerId);
      if (currentOwner !== undefined && currentOwner !== connectionId) throw new Error('Player slot already owned');
      if (currentOwner === undefined) additions++;
    }
    if (this.owners.size + additions > this.maxPlayers) throw new Error('Session full');
    const slots = this.connections.get(connectionId) ?? new Set<SessionPlayerId>();
    for (const playerId of claimed) {
      slots.add(playerId);
      this.owners.set(playerId, connectionId);
    }
    this.connections.set(connectionId, slots);
    if (!this.hostAssigned) {
      this.host = connectionId;
      this.hostAssigned = true;
    }
  }

  owns(connectionId: SessionConnectionId, playerId: SessionPlayerId): boolean {
    return this.owners.get(playerId) === connectionId && this.connections.get(connectionId)?.has(playerId) === true;
  }

  hasConnection(connectionId: SessionConnectionId): boolean {
    return this.connections.has(connectionId);
  }

  /** Authorized slots for one connection, in canonical order. */
  playersOf(connectionId: SessionConnectionId): SessionPlayerId[] {
    return [...(this.connections.get(connectionId) ?? [])].sort();
  }

  assertOwns(connectionId: SessionConnectionId, playerId: SessionPlayerId): void {
    if (!this.owns(connectionId, playerId)) throw new Error('Unauthorized player input');
  }

  isHost(connectionId: SessionConnectionId): boolean {
    return this.host === connectionId && this.connections.has(connectionId);
  }

  assertHost(connectionId: SessionConnectionId): void {
    if (!this.isHost(connectionId)) throw new Error('Host authorization required');
  }

  /** Disconnect revokes all slots immediately; no implicit host migration. */
  disconnect(connectionId: SessionConnectionId): SessionPlayerId[] {
    const slots = this.connections.get(connectionId);
    if (!slots) return [];
    const revoked = [...slots].sort();
    for (const id of revoked) this.owners.delete(id);
    this.connections.delete(connectionId);
    if (this.host === connectionId) this.host = null;
    return revoked;
  }

  /** A departed host cannot be silently replaced by another player. */
  hasHost(): boolean {
    return this.host !== null && this.connections.has(this.host);
  }

  get playerCount(): number {
    return this.owners.size;
  }

  private assertId(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error('Invalid session identifier');
    }
  }
}
