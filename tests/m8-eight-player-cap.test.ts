import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MAX_PLAYERS } from '../src/game/protocol/players';
import { MAX_SNAPSHOT_BYTES, encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import {
  decodeWsServerMessage,
  encodeWsServerMessage,
  type WsServerMessage,
} from '../src/game/networking/wsMessages';
import { AuthoritativeWsSession } from '../server/ws/authoritativeWsSession';
import { startMatchServer } from '../server/ws/matchServer';

const ids = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('M8 eight-player cap through the authoritative session', () => {
  it('joins, steps and round-trips all eight slots as protocol messages', () => {
    const players = ids(MAX_PLAYERS);
    const outgoing: WsServerMessage[] = [];
    const room = new AuthoritativeWsSession({
      playerIds: players,
      onOutgoing: (_target, message) => outgoing.push(message),
    });

    for (let index = 0; index < players.length; index++) room.addConnection(`c${index + 1}`);
    for (let index = 0; index < players.length; index++) {
      expect(room.handleMessage(`c${index + 1}`, encodeClientEnvelope({
        version: 1,
        kind: 'join-request',
        sequence: 1,
        playerIds: [players[index]],
      }))?.accepted).toBe(true);
    }
    expect(room.playerCount).toBe(MAX_PLAYERS);
    expect(room.phase).toBe('starting');
    expect(room.beginMatch()).toBe(true);

    for (let tick = 0; tick < 3; tick++) room.stepOnce();
    const sent = outgoing.filter((message): message is Extract<WsServerMessage, { kind: 'snapshot' }> =>
      message.kind === 'snapshot');
    expect(sent).toHaveLength(1);

    const decoded = decodeWsServerMessage(encodeWsServerMessage(sent[0]));
    if (decoded.kind !== 'snapshot') throw new Error('Expected a snapshot');
    expect(decoded.snapshot.state.fighters.map(fighter => fighter.id)).toEqual(players);
    expect(decoded.snapshot.state.fighters).toHaveLength(MAX_PLAYERS);

    const canonical = encodeStateSnapshot(room.snapshot());
    const serverMessage = encodeWsServerMessage({ version: 1, kind: 'snapshot', snapshot: room.snapshot() });
    // Measured, not estimated: authoritative session snapshot at tick 3.
    expect(byteLength(canonical)).toBe(2083);
    expect(byteLength(serverMessage)).toBe(2126);
    expect(byteLength(canonical)).toBeLessThan(MAX_SNAPSHOT_BYTES);
    expect(sha256(canonical)).toBe('ac647d9e3adb11649d3d35b654cf6d65fe6c098e3f012bc330d4c4b391bae452');
    expect(sha256(serverMessage)).toBe('1fd0143735a03aedc54c46f6a8fe9b0ebe0cb1385d931824b197b21d3606bf41');
  });

  it('rejects a nine-player session roster and a nine-slot match server', async () => {
    expect(() => new AuthoritativeWsSession({ playerIds: ids(9) })).toThrow(/Invalid session roster/);
    await expect(startMatchServer({ port: 0, playerIds: ids(9) })).rejects.toThrow(/1\.\.8/);
  });
});
