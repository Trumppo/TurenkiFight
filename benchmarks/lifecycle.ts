import { createState, step } from '../src/game/simulation/step';
import { decodeInputFrame, type InputFrame } from '../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { GameEvent, GameState, PlayerInput } from '../src/game/simulation/types';
import {
  encodeClientEnvelope,
  type InputEnvelope,
  type JoinRequestEnvelope,
} from '../src/game/session/sessionEnvelope';
import {
  SessionEnvelopeGateway,
  type SessionEnvelopeDenialCode,
  type SessionEnvelopeResult,
  type TrustedSessionBinding,
} from '../src/game/session/sessionEnvelopeGateway';
import type { BenchmarkReplay } from './inMemory';
import {
  assertFixtureIntegrity,
  createRoster,
  sha256,
  type BenchmarkFixture,
} from './scenarios';

/**
 * Deterministic in-memory lifecycle scenarios driven through the existing
 * session envelope gateway. No sockets, no simulated impairment and no
 * measured performance. Outcomes are correctness observations only.
 */
const ROOM = 'workspace-bench';
const binding = (connectionId: string): TrustedSessionBinding => ({ connectionId, roomId: ROOM });

export type LifecycleDenial = {
  readonly tick: number;
  readonly connectionId: string;
  readonly code: SessionEnvelopeDenialCode;
};

export type LifecycleOutcome = {
  readonly scenarioId: string;
  /** No host successor is assigned: authority is revoked, never migrated. */
  readonly hostAuthority: 'not-transferred';
  readonly authoritySuccessor: null;
  /** Slots explicitly revoked at the lifecycle transition. */
  readonly revokedSlots: readonly string[];
  readonly reconnectedConnectionId: string | null;
  /** Player-ticks that consumed neutral input after a revocation. */
  readonly neutralPlayerTicks: number;
  readonly denials: readonly LifecycleDenial[];
};

export type LifecycleReplay = {
  readonly replay: BenchmarkReplay;
  readonly outcome: LifecycleOutcome;
};

type Slot = {
  playerId: string;
  connectionId: string;
  sequence: number;
  joined: boolean;
};

const joinEnvelope = (sequence: number, playerIds: string[]): JoinRequestEnvelope =>
  ({ version: 1, kind: 'join-request', sequence, playerIds });

const inputEnvelope = (sequence: number, tick: number, input: PlayerInput): InputEnvelope =>
  ({ version: 1, kind: 'input', sequence, targetTick: tick, frame: { version: 1, tick, inputs: [input] } });

function send(gateway: SessionEnvelopeGateway, connectionId: string, envelope: JoinRequestEnvelope | InputEnvelope): SessionEnvelopeResult {
  return gateway.handle(binding(connectionId), encodeClientEnvelope(envelope));
}

function accept(result: SessionEnvelopeResult, context: string): void {
  if (!result.accepted) throw new Error(`${context} was denied: ${result.code}`);
}

function deny(result: SessionEnvelopeResult, expected: SessionEnvelopeDenialCode, denials: LifecycleDenial[], tick: number, connectionId: string): void {
  if (result.accepted) throw new Error(`Expected ${expected} but the ${tick}/${connectionId} message was accepted`);
  if (result.code !== expected) throw new Error(`Expected ${expected} but got ${result.code}`);
  denials.push({ tick, connectionId, code: result.code });
}

function scheduledInputs(fixture: BenchmarkFixture, tick: number, roster: readonly string[]): PlayerInput[] {
  const frames = fixture.framesByTick[tick];
  if (frames.length !== roster.length) throw new Error('Invalid fixture');
  return frames.map((encoded, index) => {
    const frame: InputFrame = decodeInputFrame(encoded);
    if (frame.tick !== tick || frame.inputs.length !== 1 || frame.inputs[0].playerId !== roster[index]) {
      throw new Error('Invalid fixture');
    }
    return frame.inputs[0];
  });
}

/**
 * Runs `FAIL-4-HOST-EXIT` or `FAIL-4-RECONNECT` and returns both the replay
 * fingerprints and the observable lifecycle outcome.
 */
export function replayLifecycleScenario(fixture: BenchmarkFixture): LifecycleReplay {
  const scenario = assertFixtureIntegrity(fixture);
  if (scenario.kind !== 'lifecycle' || !scenario.lifecycle) {
    throw new Error(`Scenario ${scenario.id} is not a lifecycle scenario`);
  }
  const roster = createRoster(scenario.players);
  const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
  const slots: Slot[] = roster.map((playerId, index) => ({
    playerId,
    connectionId: `conn-${index + 1}`,
    sequence: 0,
    joined: false,
  }));
  const denials: LifecycleDenial[] = [];
  const events: GameEvent[] = [];
  const revokedSlots: string[] = [];
  const reconnectedConnectionId: string | null = scenario.lifecycle.reconnectTick === undefined
    ? null
    : `${slots[1].connectionId}-b`;
  let neutralPlayerTicks = 0;
  let state: GameState = createState([...roster], 'fighting');

  for (const slot of slots) {
    accept(send(gateway, slot.connectionId, joinEnvelope(1, [slot.playerId])), 'initial join');
    slot.sequence = 1;
    slot.joined = true;
  }

  const host = slots[0];
  for (let tick = 0; tick < scenario.ticks; tick++) {
    const inputs = scheduledInputs(fixture, tick, roster);

    if (scenario.lifecycle.hostExitTick === tick) {
      const revoked = gateway.disconnect(host.connectionId);
      if (revoked.length !== 1 || revoked[0] !== host.playerId) {
        throw new Error('Host disconnect did not revoke exactly the host slot');
      }
      host.joined = false;
      revokedSlots.push(...revoked);
      // Stale input from the revoked identity must be rejected outright.
      deny(
        send(gateway, host.connectionId, inputEnvelope(host.sequence + 1, tick, inputs[0])),
        'not-joined', denials, tick, host.connectionId,
      );
      // No remaining connection silently absorbs the freed host slot.
      const other = slots[1];
      deny(
        send(gateway, other.connectionId, joinEnvelope(other.sequence + 1, [host.playerId])),
        'already-joined', denials, tick, other.connectionId,
      );
      if (gateway.playerCount !== roster.length - 1) throw new Error('Host authority migrated implicitly');
    }

    if (scenario.lifecycle.disconnectTick === tick) {
      const disconnected = slots[1];
      const revoked = gateway.disconnect(disconnected.connectionId);
      if (revoked.length !== 1 || revoked[0] !== disconnected.playerId) {
        throw new Error('Reconnect scenario revoked an unexpected slot');
      }
      disconnected.joined = false;
      revokedSlots.push(...revoked);
      deny(
        send(gateway, disconnected.connectionId, inputEnvelope(disconnected.sequence + 1, tick, inputs[1])),
        'not-joined', denials, tick, disconnected.connectionId,
      );
    }

    if (scenario.lifecycle.reconnectTick === tick) {
      const reconnecting = slots[1];
      if (reconnectedConnectionId === null) throw new Error('Missing reconnect identity');
      // A fresh connection identity cannot submit before a new join.
      deny(
        send(gateway, reconnectedConnectionId, inputEnvelope(1, tick, inputs[1])),
        'not-joined', denials, tick, reconnectedConnectionId,
      );
      // The old identity stays revoked.
      deny(
        send(gateway, reconnecting.connectionId, inputEnvelope(reconnecting.sequence + 1, tick, inputs[1])),
        'not-joined', denials, tick, reconnecting.connectionId,
      );
      // Reconnect is a fresh join with a fresh sequence domain, not ownership recovery.
      accept(send(gateway, reconnectedConnectionId, joinEnvelope(1, [reconnecting.playerId])), 'reconnect join');
      reconnecting.connectionId = reconnectedConnectionId;
      reconnecting.sequence = 1;
      reconnecting.joined = true;
      if (gateway.playerCount !== roster.length) throw new Error('Reconnect did not restore an authorized slot');
    }

    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (!slot.joined) {
        neutralPlayerTicks++;
        continue;
      }
      slot.sequence += 1;
      accept(send(gateway, slot.connectionId, inputEnvelope(slot.sequence, tick, inputs[index])), 'authorized input');
    }

    const frame: InputFrame = gateway.consume();
    if (frame.tick !== state.tick) throw new Error('Authoritative tick diverged');
    state = step(state, frame.inputs);
    events.push(...state.events);
  }

  if (state.tick !== scenario.ticks || state.phase !== 'results') throw new Error('Incomplete match');
  if (scenario.lifecycle.hostExitTick !== undefined) {
    if (gateway.playerCount !== roster.length - 1 || host.joined) throw new Error('Host authority migrated implicitly');
  }
  if (reconnectedConnectionId !== null) {
    const reconnected = slots[1];
    if (!gateway.isJoined(reconnectedConnectionId) || gateway.isJoined('conn-2') || gateway.playerCount !== roster.length) {
      throw new Error('Reconnect did not create a fresh authorization');
    }
  }

  const outcome: LifecycleOutcome = {
    scenarioId: scenario.id,
    hostAuthority: 'not-transferred',
    authoritySuccessor: null,
    revokedSlots,
    reconnectedConnectionId,
    neutralPlayerTicks,
    denials,
  };
  const lifecycleSha256 = sha256(JSON.stringify(outcome));
  return {
    outcome,
    replay: {
      scenarioId: fixture.scenarioId,
      scenarioVersion: fixture.scenarioVersion,
      players: fixture.players,
      inputHz: fixture.inputHz,
      snapshotHz: fixture.snapshotHz,
      impairment: fixture.impairment,
      seed: fixture.seed,
      fixtureSha256: fixture.fixtureSha256,
      finalStateSha256: sha256(encodeStateSnapshot({ version: 1, state })),
      finalStateEncoding: 'state-snapshot-v1',
      orderedEventsSha256: sha256(JSON.stringify(events)),
      lifecycleSha256,
      finalTick: state.tick,
      result: 'NOT_MEASURED',
    },
  };
}
