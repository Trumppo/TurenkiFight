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
  /**
   * Slots kept for a disconnected connection during the rejoin window. The
   * player still counts as claimed, but the connection is no longer active:
   * `owns`, `hasConnection` and `isHost` all return false for it.
   */
  private readonly reservations = new Map<SessionConnectionId, Set<SessionPlayerId>>();
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

  /** Disconnect revokes all active slots immediately; no implicit host migration. */
  disconnect(connectionId: SessionConnectionId): SessionPlayerId[] {
    const slots = this.connections.get(connectionId);
    if (slots) {
      const revoked = [...slots].sort();
      for (const id of revoked) this.owners.delete(id);
      this.connections.delete(connectionId);
      if (this.host === connectionId) this.host = null;
      return revoked;
    }
    // A reservation is a detached connection; releasing it is explicit and
    // still removes the claimed slots. Never leave dangling ownership behind.
    return this.releaseReserved(connectionId);
  }

  /**
   * Detaches an active connection while keeping its slots claimed for a later
   * rejoin. The player count is unchanged and the host is not migrated: a
   * reserved host leaves `hasHost()` false, exactly like a departed host.
   */
  reserve(connectionId: SessionConnectionId): SessionPlayerId[] {
    this.assertId(connectionId);
    if (this.reservations.has(connectionId)) return [];
    const slots = this.connections.get(connectionId);
    if (!slots) return [];
    const reserved = [...slots].sort();
    this.connections.delete(connectionId);
    if (this.host === connectionId) this.host = null;
    this.reservations.set(connectionId, new Set(reserved));
    return reserved;
  }

  /**
   * Transfers one complete reservation to a new trusted connection. The whole
   * reserved slot set must be reclaimed at once so a peer cannot take a subset
   * and leave a second, partially authorized connection behind.
   */
  reclaim(connectionId: SessionConnectionId, playerIds: readonly SessionPlayerId[]): void {
    this.assertId(connectionId);
    if (this.connections.has(connectionId)) throw new Error('Connection already joined');
    if (!Array.isArray(playerIds) || playerIds.length < 1) throw new Error('Invalid player slots');
    const claimed = new Set<SessionPlayerId>();
    let owner: SessionConnectionId | null = null;
    for (const playerId of playerIds) {
      this.assertId(playerId);
      if (claimed.has(playerId)) throw new Error('Duplicate player slot');
      claimed.add(playerId);
      const reservationOwner = this.reservationOwner(playerId);
      if (reservationOwner === null) throw new Error('Player slot is not reserved');
      if (owner !== null && reservationOwner !== owner) {
        throw new Error('Player slots belong to different reservations');
      }
      owner = reservationOwner;
    }
    const slots = this.reservations.get(owner as SessionConnectionId) as Set<SessionPlayerId>;
    if (slots.size !== claimed.size) throw new Error('Reservation must be reclaimed in full');
    this.reservations.delete(owner as SessionConnectionId);
    for (const playerId of claimed) this.owners.set(playerId, connectionId);
    this.connections.set(connectionId, claimed);
    if (!this.hostAssigned) {
      this.host = connectionId;
      this.hostAssigned = true;
    }
  }

  /** Releases a reservation after its window: the slots become free again. */
  releaseReserved(connectionId: SessionConnectionId): SessionPlayerId[] {
    const slots = this.reservations.get(connectionId);
    if (!slots) return [];
    this.reservations.delete(connectionId);
    const revoked = [...slots].sort();
    for (const playerId of revoked) this.owners.delete(playerId);
    return revoked;
  }

  /** A departed host cannot be silently replaced by another player. */
  hasHost(): boolean {
    return this.host !== null && this.connections.has(this.host);
  }

  get playerCount(): number {
    return this.owners.size;
  }

  /** Slots currently held open for a rejoin, not owned by an active connection. */
  get reservedCount(): number {
    return this.reservations.size;
  }

  private reservationOwner(playerId: SessionPlayerId): SessionConnectionId | null {
    for (const [connectionId, slots] of this.reservations) {
      if (slots.has(playerId)) return connectionId;
    }
    return null;
  }

  private assertId(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error('Invalid session identifier');
    }
  }
}
