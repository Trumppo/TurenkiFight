import {
  MAX_PEERS_PER_ROOM,
  SIGNALING_PROTOCOL_VERSION,
  decodeClientSignalingMessage,
  type SignalingClientMessage,
  type SignalingRole,
  type SignalingServerMessage,
} from '../../src/game/networking/signalingMessages';

const PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isPeerId = (value: unknown): value is string => typeof value === 'string' && PEER_ID.test(value);

/**
 * Room-scoped signaling relay for the WebRTC prototype.
 *
 * This module is intentionally transport-neutral and contains **only**
 * offer/answer/ICE routing. It does not import the session envelope gateway,
 * the simulation or any gameplay code: a signaling message can never authorize
 * input, claim a player slot or advance a tick. Peer IDs are allocated by the
 * transport adapter and are never read from client JSON.
 */
export type SignalingRelayOptions = {
  roomId?: string;
  maxPeers?: number;
  onOutgoing: (peerId: string, message: SignalingServerMessage) => void;
};

export const DEFAULT_SIGNALING_ROOM_ID = 'webrtc-prototype';

export class SignalingRelay {
  private readonly roomId: string;
  private readonly maxPeers: number;
  private readonly onOutgoing: (peerId: string, message: SignalingServerMessage) => void;
  /** `null` means registered transport but not joined to the room yet. */
  private readonly peers = new Map<string, SignalingRole | null>();
  private readonly lastSequence = new Map<string, number>();
  private closed = false;

  constructor(options: SignalingRelayOptions) {
    const roomId = options?.roomId ?? DEFAULT_SIGNALING_ROOM_ID;
    if (!isPeerId(roomId)) throw new Error('Invalid signaling room binding');
    const maxPeers = options.maxPeers ?? MAX_PEERS_PER_ROOM;
    if (!Number.isSafeInteger(maxPeers) || maxPeers < 2 || maxPeers > MAX_PEERS_PER_ROOM) {
      throw new Error('Invalid signaling peer capacity');
    }
    if (typeof options.onOutgoing !== 'function') throw new Error('Signaling relay requires an outgoing sink');
    this.roomId = roomId;
    this.maxPeers = maxPeers;
    this.onOutgoing = options.onOutgoing;
  }

  get room(): string { return this.roomId; }
  get peerCount(): number { return this.peers.size; }
  get joinedCount(): number {
    let count = 0;
    for (const role of this.peers.values()) if (role !== null) count += 1;
    return count;
  }

  roleOf(peerId: string): SignalingRole | null | undefined {
    return this.peers.get(peerId);
  }

  /** Registers a transport identity. The relay never learns it from a payload. */
  addPeer(peerId: string): void {
    if (!isPeerId(peerId)) throw new Error('Invalid signaling peer');
    if (this.closed) throw new Error('Signaling relay is closed');
    if (this.peers.has(peerId)) throw new Error('Signaling peer already registered');
    if (this.peers.size >= this.maxPeers) throw new Error('Signaling room is full');
    this.peers.set(peerId, null);
  }

  /**
   * Handles one client message. Returns `true` when a valid control message was
   * processed; every denial is sent as `error` and never mutates relay state
   * beyond the deny path.
   */
  handleMessage(peerId: string, data: string | Uint8Array): boolean {
    if (!this.peers.has(peerId)) return false;

    let message: SignalingClientMessage;
    try {
      message = decodeClientSignalingMessage(data);
    } catch (error) {
      this.error(peerId, 'malformed-message',
        error instanceof Error ? error.message : 'Malformed signaling message');
      return false;
    }

    if (message.kind === 'join') {
      // Room scope comes from the relay binding; the join may only agree with it.
      if (message.roomId !== this.roomId) {
        this.error(peerId, 'room-mismatch', 'Signaling message is bound to another room');
        return false;
      }
      return this.join(peerId, message);
    }
    return this.signal(peerId, message);
  }

  disconnect(peerId: string): void {
    const role = this.peers.get(peerId);
    if (role === undefined) return;
    this.peers.delete(peerId);
    this.lastSequence.delete(peerId);
    if (role === null) return;
    for (const [otherId, otherRole] of this.peers) {
      if (otherRole === null) continue;
      this.send(otherId, {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'peer-left',
        peerId,
      });
    }
  }

  close(): void {
    this.closed = true;
    this.peers.clear();
    this.lastSequence.clear();
  }

  private join(peerId: string, message: Extract<SignalingClientMessage, { kind: 'join' }>): boolean {
    if (this.peers.get(peerId) != null) {
      this.error(peerId, 'already-joined', 'Signaling peer already joined');
      return false;
    }
    if (message.role === 'host' && this.hasHost()) {
      this.error(peerId, 'host-exists', 'Signaling room already has a host');
      return false;
    }
    if (this.joinedCount >= this.maxPeers) {
      this.error(peerId, 'session-full', 'Signaling room is full');
      return false;
    }

    this.peers.set(peerId, message.role);
    const peers = [...this.peers.entries()]
      .filter(([otherId, role]) => otherId !== peerId && role !== null)
      .map(([otherId, role]) => ({ peerId: otherId, role: role as SignalingRole }));
    this.send(peerId, {
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'joined',
      peerId,
      role: message.role,
      peers,
    });
    for (const peer of peers) {
      this.send(peer.peerId, {
        version: SIGNALING_PROTOCOL_VERSION,
        kind: 'peer-joined',
        peerId,
        role: message.role,
      });
    }
    return true;
  }

  private signal(peerId: string, message: Extract<SignalingClientMessage, { kind: 'signal' }>): boolean {
    if (this.peers.get(peerId) == null) {
      this.error(peerId, 'not-joined', 'Signaling peer has not joined the room');
      return false;
    }
    const previous = this.lastSequence.get(peerId);
    if (previous !== undefined && message.sequence <= previous) {
      this.error(peerId, 'replayed-sequence', 'Replayed or stale signaling sequence');
      return false;
    }
    if (message.target === peerId) {
      this.error(peerId, 'invalid-target', 'A peer cannot signal itself');
      return false;
    }
    if (this.peers.get(message.target) == null) {
      this.error(peerId, 'unknown-target', 'Signaling target is not present in this room');
      return false;
    }

    this.lastSequence.set(peerId, message.sequence);
    this.send(message.target, {
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      from: peerId,
      ...(message.description === undefined ? {} : { description: message.description }),
      ...(message.candidate === undefined ? {} : { candidate: message.candidate }),
    });
    return true;
  }

  private hasHost(): boolean {
    for (const role of this.peers.values()) if (role === 'host') return true;
    return false;
  }

  private error(peerId: string, code: string, message: string): void {
    this.send(peerId, { version: SIGNALING_PROTOCOL_VERSION, kind: 'error', code, message });
  }

  private send(peerId: string, message: SignalingServerMessage): void {
    this.onOutgoing(peerId, message);
  }
}
