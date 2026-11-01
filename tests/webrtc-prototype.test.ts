import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_ENVELOPE_BYTES,
  decodeClientEnvelope,
  encodeClientEnvelope,
} from '../src/game/session/sessionEnvelope';
import { createState } from '../src/game/simulation/step';
import type { PlayerInput } from '../src/game/simulation/types';
import { decodeStateSnapshot, encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import {
  attachDataChannelSession,
  type DataChannelPort,
  type DataChannelSession,
} from '../src/game/networking/dataChannelSession';
import { WebrtcHostSession, type WebrtcHostSessionOptions } from '../src/game/networking/webrtcHostSession';
import {
  MAX_SIGNALING_MESSAGE_BYTES,
  SIGNALING_PROTOCOL_VERSION,
  decodeClientSignalingMessage,
  decodeServerSignalingMessage,
  encodeClientSignalingMessage,
  encodeServerSignalingMessage,
  type SignalingServerMessage,
} from '../src/game/networking/signalingMessages';
import {
  encodeWsServerMessage,
  type WsServerMessage,
} from '../src/game/networking/wsMessages';
import { SignalingRelay } from '../server/signaling/signalingRelay';
import { createLoopbackDataChannelPair } from '../benchmarks/webrtc/loopbackDataChannel';
import {
  createWebrtcPrototypeManifest,
  validateWebrtcPrototypeManifest,
} from '../benchmarks/webrtc/webrtcManifest';

/**
 * Deterministic architecture-B tests.
 *
 * Every peer here is an injected in-memory DataChannel: no socket, RTCPeerConnection
 * or browser is required. The browser negotiation path is covered separately by
 * one Playwright test that skips when WebRTC is unavailable.
 */

const ROOM = 'webrtc-room';
const PLAYERS = ['P1', 'P2', 'P3', 'P4'];

const controls = (playerId: string, moveX: -1 | 0 | 1 = 1): PlayerInput =>
  ({ playerId, moveX, moveY: 0, jump: false });

type Captured = { target: string | null; message: WsServerMessage };

function createHost(options: WebrtcHostSessionOptions = {}): {
  host: WebrtcHostSession;
  messages: Captured[];
} {
  const messages: Captured[] = [];
  const host = new WebrtcHostSession({
    roomId: ROOM,
    playerIds: PLAYERS,
    snapshotHz: 20,
    ...options,
    onOutgoing: (target, message) => messages.push({ target, message }),
  });
  return { host, messages };
}

type Peer = {
  connectionId: string;
  session: DataChannelSession;
  errors: string[];
  protocolErrors: string[];
  sendRaw: (text: string) => void;
  close: () => void;
};

function connectPeer(host: WebrtcHostSession, playerIds: string[]): Peer {
  const pair = createLoopbackDataChannelPair();
  const connectionId = host.acceptChannel(pair.host);
  const errors: string[] = [];
  const protocolErrors: string[] = [];
  const session = attachDataChannelSession(pair.client, {
    onError: error => errors.push(error.code),
    onProtocolError: message => protocolErrors.push(message),
  });
  const peer: Peer = {
    connectionId,
    session,
    errors,
    protocolErrors,
    sendRaw: text => pair.client.send(text),
    close: () => pair.client.close(),
  };
  if (playerIds.length > 0) session.client.join(playerIds);
  return peer;
}

const messagesOf = (messages: Captured[], kind: WsServerMessage['kind']): Captured[] =>
  messages.filter(entry => entry.message.kind === kind);

const last = <T,>(values: T[]): T => values[values.length - 1];

describe('M2 WebRTC browser-host authority', () => {
  it('allocates trusted connection identity per DataChannel and rejects payload spoofing', () => {
    const { host, messages } = createHost();
    const first = connectPeer(host, ['P1']);

    expect(first.connectionId).toBe('rtc-1');
    expect(host.hostConnectionId).toBe('rtc-1');
    expect(host.playerCount).toBe(1);
    expect(messagesOf(messages, 'welcome')[0].message).toEqual({
      version: 1, kind: 'welcome', connectionId: 'rtc-1', roomId: ROOM,
    });
    expect(last(messagesOf(messages, 'join-result')).message).toMatchObject({
      accepted: true, playerIds: ['P1'],
    });

    const second = connectPeer(host, []);
    // Another channel cannot claim an owned slot.
    second.sendRaw(encodeClientEnvelope({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1'],
    }));
    expect(last(second.errors)).toBe('player-owned');

    // A payload field cannot name the trusted connection or elevate the peer.
    second.sendRaw(
      '{"version":1,"kind":"join-request","sequence":1,"playerIds":["P2"],"connectionId":"rtc-1","host":true}',
    );
    expect(last(second.errors)).toBe('unknown-field');
    expect(host.playerCount).toBe(1);

    // Slots outside the configured BASE-4 roster fail closed.
    second.sendRaw(encodeClientEnvelope({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P9'],
    }));
    expect(last(second.errors)).toBe('unknown-player');
    // Cross-room claims are denied by trusted binding, not accepted.
    second.sendRaw(encodeClientEnvelope({
      version: 1, kind: 'join-request', sequence: 1, roomId: 'other-room', playerIds: ['P2'],
    }));
    expect(last(second.errors)).toBe('room-mismatch');
    expect(host.playerCount).toBe(1);
  });

  it('freezes the roster, rejects premature and spoofed input without mutation', () => {
    const { host } = createHost();
    const peers = PLAYERS.map(playerId => connectPeer(host, [playerId]));
    expect(host.phase).toBe('starting');

    peers[1].session.client.submitInput(0, [controls('P2')]);
    expect(last(peers[1].errors)).toBe('not-started');
    expect(host.bufferedTicks).toBe(0);

    // A late connection cannot claim a slot after starting.
    const late = connectPeer(host, []);
    late.sendRaw(encodeClientEnvelope({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1'],
    }));
    expect(last(late.errors)).toBe('match-started');

    expect(host.beginMatch()).toBe(true);
    expect(host.phase).toBe('running');
    const before = host.snapshot().state.fighters.map(fighter => fighter.x);

    peers[1].sendRaw(encodeClientEnvelope({
      version: 1,
      kind: 'input',
      sequence: 2,
      targetTick: 0,
      frame: { version: 1, tick: 0, inputs: [controls('P1')] },
    }));
    expect(last(peers[1].errors)).toBe('unauthorized-player');
    expect(host.bufferedTicks).toBe(0);

    // The denied sequence is not burned: the peer can still submit its own slot.
    peers[1].session.client.submitInput(0, [controls('P2')]);
    expect(host.bufferedTicks).toBe(1);
    expect(host.stepOnce()).toMatchObject({ stepped: true, tick: 1 });

    const after = host.snapshot().state.fighters;
    expect(after[1].x).toBeGreaterThan(before[1]);
    expect(after[0].x).toBe(before[0]);

    // The accepted frame is consumed exactly once.
    expect(host.stepOnce().stepped).toBe(true);
    expect(host.snapshot().state.fighters[1].x).toBe(after[1].x);
  });

  it('emits validated snapshots over the prototype server-message codec', () => {
    const { host, messages } = createHost({ snapshotHz: 20 });
    const peers = PLAYERS.map(playerId => connectPeer(host, [playerId]));
    host.beginMatch();
    for (let tick = 0; tick < 60; tick++) host.stepOnce();

    expect(messagesOf(messages, 'snapshot')).toHaveLength(20);
    expect(peers[0].session.client.lastSnapshot?.state.tick).toBe(60);
    expect(peers[0].protocolErrors).toEqual([]);

    const finalSnapshot = peers[0].session.client.lastSnapshot;
    if (!finalSnapshot) throw new Error('Missing snapshot');
    expect(decodeStateSnapshot(encodeStateSnapshot(finalSnapshot)).state.tick).toBe(60);

    // Every broadcast is strict-encoded; an unjoined peer never receives projections.
    const unjoined = connectPeer(host, []);
    expect(unjoined.session.client.lastSnapshot).toBeNull();
  });

  it('revokes a disconnected channel but keeps host authority and the match alive', () => {
    const { host } = createHost();
    const peers = PLAYERS.map(playerId => connectPeer(host, [playerId]));
    host.beginMatch();
    for (let tick = 0; tick < 3; tick++) host.stepOnce();

    peers[1].close();
    expect(host.phase).toBe('running');
    expect(host.hostConnectionId).toBe('rtc-1');
    expect(host.playerCount).toBe(3);
    expect(host.connectionIds()).not.toContain(peers[1].connectionId);
    expect(peers[1].session.client.sessionState).toBe('closed');

    // The vacated slot consumes neutral input; the session does not stall.
    expect(host.stepOnce()).toMatchObject({ stepped: true, tick: 4 });
    expect(host.phase).toBe('running');
  });

  it('terminates on host channel loss without migrating authority', () => {
    const { host } = createHost();
    const peers = PLAYERS.map(playerId => connectPeer(host, [playerId]));
    host.beginMatch();
    for (let tick = 0; tick < 5; tick++) host.stepOnce();

    peers[0].close();
    expect(host.phase).toBe('closed');
    expect(host.hostConnectionId).toBe('rtc-1');
    expect(host.playerCount).toBe(0);
    expect(host.connectionCount).toBe(0);
    expect(host.stepOnce().stepped).toBe(false);

    // Remaining peers receive the explicit host-lost outcome, never a new host.
    expect(peers.slice(1).every(peer => peer.session.client.sessionState === 'closed')).toBe(true);
    expect(peers.slice(1).flatMap(peer => peer.errors)).not.toContain('unauthorized-player');
    expect(() => host.acceptChannel(createLoopbackDataChannelPair().host)).toThrow(/closed/);
  });

  it('handles trusted byte envelopes and rejects unsupported payloads', () => {
    const { host, messages } = createHost();
    const pair = createLoopbackDataChannelPair();
    host.acceptChannel(pair.host);
    const errors: string[] = [];
    const session = attachDataChannelSession(pair.client, { onError: error => errors.push(error.code) });
    session.client.join(['P1']);
    expect(host.playerCount).toBe(1);

    const ping = new Uint8Array(new TextEncoder().encode(
      encodeClientEnvelope({ version: 1, kind: 'ping', sequence: 2 }),
    ));
    pair.host.onmessage?.({ data: ping });
    expect(last(messagesOf(messages, 'pong')).message).toMatchObject({ sequence: 2 });

    pair.host.onmessage?.({ data: 42 });
    expect(errors).toContain('invalid-encoding');

    pair.host.onmessage?.({ data: 'x'.repeat(MAX_SESSION_ENVELOPE_BYTES + 1) });
    expect(last(errors)).toBe('oversized');

    // Invalid JSON / unknown fields are denied by the existing envelope boundary.
    pair.host.onmessage?.({ data: 'not json' });
    expect(last(errors)).toBe('invalid-json');
  });

  it('validates host configuration and DataChannel readiness', () => {
    expect(() => createHost({ maxChannels: 0 })).toThrow(/capacity/);
    expect(() => createHost({ maxChannels: 33 })).toThrow(/capacity/);
    const { host } = createHost();
    const channel: DataChannelPort = {
      readyState: 'connecting', send: () => undefined, close: () => undefined,
      onopen: null, onmessage: null, onclose: null, onerror: null,
    };
    expect(() => host.acceptChannel(channel)).toThrow(/not open/);

    const small = createHost({ maxChannels: 1 });
    connectPeer(small.host, ['P1']);
    expect(() => small.host.acceptChannel(createLoopbackDataChannelPair().host)).toThrow(/capacity/);
  });
});

describe('M2 WebRTC client DataChannel adapter', () => {
  it('queues envelopes until the injected channel opens and revokes state on close', () => {
    const sent: string[] = [];
    let closed = false;
    const channel: DataChannelPort = {
      readyState: 'connecting',
      send: data => sent.push(data),
      close: () => { closed = true; },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const events: string[] = [];
    const session = attachDataChannelSession(channel, {
      onWelcome: info => events.push(`welcome:${info.connectionId}`),
      onJoinResult: result => events.push(`join:${String(result.accepted)}`),
    });

    expect(session.client.join(['P1'])).toBe(1);
    expect(sent).toEqual([]);
    channel.readyState = 'open';
    channel.onopen?.();
    expect(sent).toHaveLength(1);
    expect(decodeClientEnvelope(sent[0]).kind).toBe('join-request');

    channel.onmessage?.({ data: encodeWsServerMessage({
      version: 1, kind: 'welcome', connectionId: 'rtc-9', roomId: ROOM,
    }) });
    channel.onmessage?.({
      data: new TextEncoder().encode(encodeWsServerMessage({
        version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'],
      })),
    });
    expect(events).toEqual(['welcome:rtc-9', 'join:true']);
    expect(session.client.sessionState).toBe('joined');
    expect(session.client.ownedPlayerIds).toEqual(['P1']);

    session.close();
    expect(closed).toBe(true);
    expect(session.client.sessionState).toBe('closed');
    expect(() => session.client.submitInput(0, [controls('P1')])).toThrow(/accepted join/);
  });

  it('does not invent authority when the host channel closes mid-match', () => {
    const { host } = createHost();
    const peers = PLAYERS.map(playerId => connectPeer(host, [playerId]));
    host.beginMatch();
    expect(host.stepOnce().stepped).toBe(true);

    // The host channel closes: the session must not promote another peer.
    peers[0].close();
    expect(host.phase).toBe('closed');
    expect(host.hostConnectionId).toBe('rtc-1');
    expect(peers[2].session.client.sessionState).toBe('closed');
    expect(peers[2].session.client.ownedPlayerIds).toEqual([]);
  });
});

describe('M2 WebRTC signaling relay', () => {
  type Outgoing = { peerId: string; message: SignalingServerMessage };

  function relayHarness(): { relay: SignalingRelay; outgoing: Outgoing[] } {
    const outgoing: Outgoing[] = [];
    const relay = new SignalingRelay({
      roomId: ROOM,
      onOutgoing: (peerId, message) => outgoing.push({ peerId, message }),
    });
    return { relay, outgoing };
  }

  const joinMessage = (roomId: string, role: 'host' | 'client'): string =>
    encodeClientSignalingMessage({ version: SIGNALING_PROTOCOL_VERSION, kind: 'join', roomId, role });
  const offerMessage = (sequence: number, target: string): string =>
    encodeClientSignalingMessage({
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      sequence,
      target,
      description: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
    });
  const candidateMessage = (sequence: number, target: string): string =>
    encodeClientSignalingMessage({
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      sequence,
      target,
      candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    });

  const toPeer = (outgoing: Outgoing[], peerId: string): SignalingServerMessage[] =>
    outgoing.filter(entry => entry.peerId === peerId).map(entry => entry.message);

  it('relays offer, answer and ICE only to the addressed peer in the same room', () => {
    const { relay, outgoing } = relayHarness();
    relay.addPeer('sig-1');
    relay.addPeer('sig-2');
    relay.addPeer('sig-3');

    expect(relay.handleMessage('sig-1', joinMessage(ROOM, 'host'))).toBe(true);
    expect(toPeer(outgoing, 'sig-1')[0]).toMatchObject({
      kind: 'joined', peerId: 'sig-1', role: 'host', peers: [],
    });

    expect(relay.handleMessage('sig-2', joinMessage(ROOM, 'client'))).toBe(true);
    expect(toPeer(outgoing, 'sig-2')[0]).toMatchObject({
      kind: 'joined', peerId: 'sig-2', role: 'client', peers: [{ peerId: 'sig-1', role: 'host' }],
    });
    expect(toPeer(outgoing, 'sig-1')[1]).toMatchObject({
      kind: 'peer-joined', peerId: 'sig-2', role: 'client',
    });

    expect(relay.handleMessage('sig-2', offerMessage(1, 'sig-1'))).toBe(true);
    const relayed = toPeer(outgoing, 'sig-1')[2];
    expect(relayed).toMatchObject({ kind: 'signal', from: 'sig-2' });
    expect(relayed).toHaveProperty('description.type', 'offer');
    // The relay never forwards to a third, unaddressed peer.
    expect(toPeer(outgoing, 'sig-3')).toEqual([]);

    expect(relay.handleMessage('sig-1', encodeClientSignalingMessage({
      version: SIGNALING_PROTOCOL_VERSION,
      kind: 'signal',
      sequence: 1,
      target: 'sig-2',
      description: { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' },
    }))).toBe(true);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'signal', from: 'sig-1' });

    expect(relay.handleMessage('sig-2', candidateMessage(2, 'sig-1'))).toBe(true);
    expect(last(toPeer(outgoing, 'sig-1'))).toMatchObject({ kind: 'signal', from: 'sig-2' });
    expect(last(toPeer(outgoing, 'sig-1'))).toHaveProperty('candidate.sdpMid', '0');
  });

  it('denies room mismatch, duplicate joins, missing joins, replay and bad targets', () => {
    const { relay, outgoing } = relayHarness();
    relay.addPeer('sig-1');
    relay.addPeer('sig-2');
    relay.addPeer('sig-3');

    expect(relay.handleMessage('sig-1', joinMessage(ROOM, 'host'))).toBe(true);
    expect(relay.handleMessage('sig-1', joinMessage(ROOM, 'client'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-1'))).toMatchObject({ kind: 'error', code: 'already-joined' });

    expect(relay.handleMessage('sig-2', joinMessage('other-room', 'client'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'error', code: 'room-mismatch' });

    expect(relay.handleMessage('sig-3', joinMessage(ROOM, 'host'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-3'))).toMatchObject({ kind: 'error', code: 'host-exists' });

    // Registered but not joined: no gameplay or signaling state is accepted.
    expect(relay.handleMessage('sig-3', candidateMessage(1, 'sig-1'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-3'))).toMatchObject({ kind: 'error', code: 'not-joined' });

    expect(relay.handleMessage('sig-2', joinMessage(ROOM, 'client'))).toBe(true);
    expect(relay.handleMessage('sig-2', offerMessage(1, 'sig-3'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'error', code: 'unknown-target' });
    expect(relay.handleMessage('sig-2', offerMessage(1, 'sig-2'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'error', code: 'invalid-target' });
    expect(relay.handleMessage('sig-2', offerMessage(1, 'sig-1'))).toBe(true);
    expect(relay.handleMessage('sig-2', candidateMessage(1, 'sig-1'))).toBe(false);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'error', code: 'replayed-sequence' });

    expect(relay.handleMessage('sig-2', 'not json')).toBe(false);
    expect(last(toPeer(outgoing, 'sig-2'))).toMatchObject({ kind: 'error', code: 'malformed-message' });

    // Unknown transport identities are ignored without an outgoing message.
    const beforeUnknown = outgoing.length;
    expect(relay.handleMessage('sig-9', offerMessage(1, 'sig-1'))).toBe(false);
    expect(outgoing.length).toBe(beforeUnknown);
  });

  it('broadcasts peer-left and keeps retired peers out of the room', () => {
    const { relay, outgoing } = relayHarness();
    relay.addPeer('sig-1');
    relay.addPeer('sig-2');
    relay.handleMessage('sig-1', joinMessage(ROOM, 'host'));
    relay.handleMessage('sig-2', joinMessage(ROOM, 'client'));

    relay.disconnect('sig-2');
    expect(last(toPeer(outgoing, 'sig-1'))).toMatchObject({ kind: 'peer-left', peerId: 'sig-2' });
    expect(relay.joinedCount).toBe(1);
    expect(relay.handleMessage('sig-2', offerMessage(1, 'sig-1'))).toBe(false);

    expect(() => relay.addPeer('sig-1')).toThrow(/registered/);
    expect(() => relay.addPeer('bad peer')).toThrow(/peer/);
  });

  it('validates signaling codec shapes, sizes and versions', () => {
    const offer = {
      version: SIGNALING_PROTOCOL_VERSION as 1,
      kind: 'signal' as const,
      sequence: 1,
      target: 'sig-1',
      description: { type: 'offer' as const, sdp: 'v=0' },
    };
    expect(decodeClientSignalingMessage(encodeClientSignalingMessage(offer))).toEqual(offer);
    expect(() => decodeClientSignalingMessage(
      '{"version":1,"kind":"signal","sequence":1,"target":"sig-1","description":{"type":"offer","sdp":"v=0"},"candidate":{"candidate":"x","sdpMid":null,"sdpMLineIndex":null}}',
    )).toThrow();
    expect(() => decodeClientSignalingMessage(
      '{"version":2,"kind":"join","roomId":"room","role":"host"}',
    )).toThrow();
    expect(() => decodeClientSignalingMessage(
      '{"version":1,"kind":"join","roomId":"room","role":"admin"}',
    )).toThrow();
    expect(() => decodeClientSignalingMessage(
      '{"version":1,"kind":"join","roomId":"room","role":"host","host":true}',
    )).toThrow();
    expect(() => decodeClientSignalingMessage(
      JSON.stringify({ ...offer, description: undefined, candidate: undefined }),
    )).toThrow();
    expect(() => decodeClientSignalingMessage('x'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 1))).toThrow(/size/);

    const serverMessages: SignalingServerMessage[] = [
      { version: 1, kind: 'joined', peerId: 'sig-1', role: 'host', peers: [{ peerId: 'sig-2', role: 'client' }] },
      { version: 1, kind: 'peer-joined', peerId: 'sig-2', role: 'client' },
      { version: 1, kind: 'peer-left', peerId: 'sig-2' },
      { version: 1, kind: 'signal', from: 'sig-2', candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: null } },
      { version: 1, kind: 'error', code: 'room-mismatch', message: 'wrong room' },
    ];
    for (const message of serverMessages) {
      expect(decodeServerSignalingMessage(encodeServerSignalingMessage(message))).toEqual(message);
    }
    expect(() => decodeServerSignalingMessage(
      '{"version":1,"kind":"joined","peerId":"sig-1","role":"host","peers":[{"peerId":"sig-1","role":"host"}]}',
    )).toThrow();
    expect(() => decodeServerSignalingMessage(
      '{"version":1,"kind":"error","code":"Bad Code","message":"x"}',
    )).toThrow();
  });
});

describe('M2 WebRTC prototype manifest', () => {
  const hash = 'a'.repeat(64);
  const correctness = {
    finalTick: 300,
    matchesInMemoryReference: true,
    finalStateSha256: hash,
    referenceFinalStateSha256: hash,
    orderedEventsSha256: hash,
    referenceOrderedEventsSha256: hash,
    lateTicks: 0,
    deniedMessages: 0,
  };
  const manifest = () => createWebrtcPrototypeManifest({
    runId: 'webrtc-base4-1',
    commitSha: 'b'.repeat(40),
    fixtureSha256: 'c'.repeat(64),
    seed: 12345,
    snapshotHz: 20,
    maxLeadTicks: 8,
    boundedTicks: 300,
    correctness,
  });

  it('records architecture B correctly and keeps every performance field NOT_MEASURED', () => {
    const value = manifest();
    expect(value.architecture).toBe('architecture-b');
    expect(value.authority).toBe('browser-host');
    expect(value.transport).toBe('webrtc-datachannel-emulated');
    expect(value.result).toBe('NOT_MEASURED');
    expect(value.measurements).toEqual({
      latency: 'NOT_MEASURED', bandwidth: 'NOT_MEASURED', cpu: 'NOT_MEASURED', tickPacing: 'NOT_MEASURED',
    });
    expect(value.environment).toEqual({
      signaling: 'in-memory', tls: false, turn: false, natTraversal: 'not-attempted',
      os: 'NOT_MEASURED', browser: 'NOT_MEASURED', cpu: 'NOT_MEASURED',
    });
  });

  it('rejects substituted measurements, inconsistent fingerprints and invalid bounds', () => {
    const base = manifest();
    expect(() => createWebrtcPrototypeManifest({
      runId: 'webrtc-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 0, correctness,
    })).toThrow();
    expect(() => createWebrtcPrototypeManifest({
      runId: 'webrtc-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 300,
      correctness: { ...correctness, finalTick: 301 },
    })).toThrow();
    expect(() => createWebrtcPrototypeManifest({
      runId: 'webrtc-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 300,
      correctness: { ...correctness, matchesInMemoryReference: false },
    })).toThrow();

    const withMeasurement = structuredClone(base) as unknown as { measurements: { latency: unknown } };
    withMeasurement.measurements.latency = 0;
    expect(() => validateWebrtcPrototypeManifest(withMeasurement)).toThrow();
    const wrongArchitecture = structuredClone(base) as unknown as { architecture: string };
    wrongArchitecture.architecture = 'architecture-a';
    expect(() => validateWebrtcPrototypeManifest(wrongArchitecture)).toThrow();
  });
});

describe('M2 WebRTC prototype boundaries', () => {
  it('keeps Node and server-only imports out of src/game/networking', () => {
    const directory = resolve(process.cwd(), 'src/game/networking');
    const files = readdirSync(directory).filter(file => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(joinPath(directory, file), 'utf8');
      expect(content).not.toMatch(/from\s+['"]ws['"]/);
      expect(content).not.toMatch(/require\(['"]ws['"]\)/);
      expect(content).not.toMatch(/from\s+['"]node:/);
      expect(content).not.toMatch(/WebSocketServer/);
    }
  });

  it('keeps signaling free of session authority and simulation code', () => {
    const directory = resolve(process.cwd(), 'server/signaling');
    const files = readdirSync(directory).filter(file => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(joinPath(directory, file), 'utf8');
      expect(content).not.toMatch(/SessionEnvelopeGateway/);
      expect(content).not.toMatch(/AuthoritativeWsSession/);
      expect(content).not.toMatch(/simulation\//);
      expect(content).not.toMatch(/sessionEnvelopeGateway/);
    }
  });

  it('creates the initial authoritative state without touching simulation rules', () => {
    const state = createState(['P1'], 'fighting');
    expect(state.tick).toBe(0);
    expect(state.phase).toBe('fighting');
    expect(state.fighters).toHaveLength(1);
  });
});
