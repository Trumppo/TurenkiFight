import {
  AuthoritativeWsSession,
  type WsSessionOptions,
  type WsSessionPhase,
  type WsStepResult,
} from '../../../server/ws/authoritativeWsSession';
import type { GameEvent } from '../simulation/types';
import type { StateSnapshot } from '../protocol/stateSnapshot';
import { encodeWsServerMessage, type WsServerMessage } from './wsMessages';
import type { DataChannelPort } from './dataChannelSession';

/**
 * Browser-host authority for architecture B.
 *
 * This is a thin transport shell around the *existing* authoritative session
 * (`server/ws/authoritativeWsSession`) which already owns deterministic
 * `step()` + `SessionEnvelopeGateway` semantics. Reusing it avoids a second,
 * divergent implementation of authorization, sequencing, ticks or host loss.
 *
 * Trust model in this prototype: the host allocates a fresh `rtc-N` connection
 * ID per accepted DataChannel. A client payload can never name or change that
 * ID. Closing the host's own channel still terminates the session with
 * `session-closed: host-lost`; authority is never migrated to another peer.
 *
 * No production authentication, encryption, rate limiting or NAT handling is
 * implemented here.
 */
export type WebrtcHostSessionOptions = Omit<WsSessionOptions, 'onOutgoing' | 'onPhaseChange'> & {
  /** Hard cap on simultaneously accepted DataChannels. */
  maxChannels?: number;
  onOutgoing?: (targetConnectionId: string | null, message: WsServerMessage) => void;
  onPhaseChange?: (phase: WsSessionPhase) => void;
};

export type WebrtcHostChannel = {
  connectionId: string;
  channel: DataChannelPort;
};

const DEFAULT_MAX_CHANNELS = 8;

const PROJECTION_MESSAGES: ReadonlySet<WsServerMessage['kind']> = new Set([
  'snapshot',
  'match-start',
  'match-end',
  'run-complete',
]);

export class WebrtcHostSession {
  private readonly session: AuthoritativeWsSession;
  private readonly channels = new Map<string, DataChannelPort>();
  private readonly maxChannels: number;
  private readonly onOutgoing: (targetConnectionId: string | null, message: WsServerMessage) => void;
  private nextConnectionId = 1;

  constructor(options: WebrtcHostSessionOptions = {}) {
    const maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
    if (!Number.isSafeInteger(maxChannels) || maxChannels < 1 || maxChannels > 32) {
      throw new Error('Invalid DataChannel capacity');
    }
    this.maxChannels = maxChannels;
    this.onOutgoing = options.onOutgoing ?? (() => undefined);
    const { maxChannels: _ignored, onOutgoing: _ignoredOutgoing, ...sessionOptions } = options;
    this.session = new AuthoritativeWsSession({
      ...sessionOptions,
      onOutgoing: (target, message) => this.route(target, message),
      onPhaseChange: phase => options.onPhaseChange?.(phase),
    });
  }

  get gameSession(): AuthoritativeWsSession { return this.session; }
  get phase(): WsSessionPhase { return this.session.phase; }
  get tick(): number { return this.session.tick; }
  get bufferedTicks(): number { return this.session.bufferedTicks; }
  get playerCount(): number { return this.session.playerCount; }
  get connectionCount(): number { return this.session.connectionCount; }
  get hostConnectionId(): string | null { return this.session.hostConnectionId; }
  get channelCount(): number { return this.channels.size; }
  get isRunComplete(): boolean { return this.session.isRunComplete; }

  isJoined(connectionId: string): boolean {
    return this.session.isJoined(connectionId);
  }

  channelFor(connectionId: string): DataChannelPort | undefined {
    return this.channels.get(connectionId);
  }

  connectionIds(): string[] {
    return [...this.channels.keys()];
  }

  /**
   * Registers one open DataChannel under a host-allocated trusted connection
   * ID and immediately sends the session `welcome` message.
   */
  acceptChannel(channel: DataChannelPort): string {
    if (!channel || typeof channel.send !== 'function' || typeof channel.close !== 'function') {
      throw new Error('Invalid DataChannel');
    }
    if (channel.readyState !== 'open') throw new Error('DataChannel is not open');
    if (this.session.phase === 'closed') {
      try { channel.close(); } catch { /* already closed */ }
      throw new Error('Host session is closed');
    }
    if (this.channels.size >= this.maxChannels) {
      try { channel.close(); } catch { /* already closed */ }
      throw new Error('DataChannel capacity reached');
    }

    const connectionId = `rtc-${this.nextConnectionId++}`;
    this.channels.set(connectionId, channel);
    channel.onmessage = event => this.handleChannelMessage(connectionId, event?.data);
    channel.onclose = () => this.dropChannel(connectionId);
    channel.onerror = () => {
      // A real RTCDataChannel emits `close` next; transport closure revokes slots.
    };
    channel.onopen = null;

    try {
      this.session.addConnection(connectionId);
    } catch (error) {
      this.channels.delete(connectionId);
      channel.onmessage = null;
      channel.onclose = null;
      try { channel.close(); } catch { /* already closed */ }
      throw error;
    }
    if (!this.channels.has(connectionId)) throw new Error('DataChannel closed during registration');
    return connectionId;
  }

  /** Advances one authoritative tick; the host role owns the clock. */
  stepOnce(): WsStepResult {
    return this.session.stepOnce();
  }

  beginMatch(): boolean {
    return this.session.beginMatch();
  }

  snapshot(): StateSnapshot {
    return this.session.snapshot();
  }

  orderedEvents(): GameEvent[] {
    return this.session.orderedEvents();
  }

  /**
   * Terminates the session and closes every accepted channel. The existing
   * host-loss policy is preserved: no authority migrates.
   */
  close(reason: 'host-lost' | 'match-complete' = 'host-lost'): void {
    if (this.session.phase !== 'closed') this.session.close(reason);
    for (const channel of this.channels.values()) {
      try { channel.close(); } catch { /* already closed */ }
    }
    this.channels.clear();
  }

  private handleChannelMessage(connectionId: string, data: unknown): void {
    if (!this.channels.has(connectionId)) return;
    if (typeof data === 'string' || data instanceof Uint8Array) {
      this.session.handleMessage(connectionId, data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.session.handleMessage(connectionId, new Uint8Array(data));
      return;
    }
    // The control plane must not interpret arbitrary payload types.
    this.sendToChannel(connectionId, {
      version: 1,
      kind: 'error',
      code: 'invalid-encoding',
      message: 'Unsupported DataChannel payload',
    });
  }

  private dropChannel(connectionId: string): void {
    if (!this.channels.delete(connectionId)) return;
    this.session.disconnect(connectionId);
  }

  private sendToChannel(connectionId: string, message: WsServerMessage): void {
    const channel = this.channels.get(connectionId);
    if (!channel) return;
    let encoded: string;
    try {
      encoded = encodeWsServerMessage(message);
    } catch {
      return;
    }
    try {
      channel.send(encoded);
    } catch {
      // A failed send is a broken transport: revoke it instead of retrying.
      try { channel.close(); } catch { /* already closed */ }
      this.dropChannel(connectionId);
    }
  }

  private route(targetConnectionId: string | null, message: WsServerMessage): void {
    this.onOutgoing(targetConnectionId, message);
    if (targetConnectionId !== null) {
      this.sendToChannel(targetConnectionId, message);
      return;
    }
    const projection = PROJECTION_MESSAGES.has(message.kind);
    for (const connectionId of this.channels.keys()) {
      // Match the WebSocket prototype: project authoritative state only to
      // joined peers, while lifecycle/control messages reach every channel.
      if (projection && !this.session.isJoined(connectionId)) continue;
      this.sendToChannel(connectionId, message);
    }
  }
}
