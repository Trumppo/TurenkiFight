import { describe, expect, it } from 'vitest';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';

const controls = (playerId: string, moveX: -1 | 0 | 1 = 0) =>
  ({ playerId, moveX, moveY: 0 as const, jump: false });

describe('Independent M2 ingress authorization and replay gate', () => {
  it('rejects spoofing without consuming sequence or modifying queued frames', () => {
    const room = new AuthorizedSessionIngress(0, 3, 2);
    room.join('alice', 'P1');
    room.join('bob', 'P2');
    room.submit('alice', 0, 1, controls('P1', 1));
    expect(() => room.submit('bob', 0, 1, controls('P1', -1))).toThrow(/Unauthorized/);
    expect(() => room.submit('bob', 0, 1, { ...controls('P2'), jump: 1 as never })).toThrow(/Malformed/);
    expect(room.bufferedTicks).toBe(1);
    room.submit('bob', 0, 1, controls('P2', -1));
    expect(consumeAuthorizedFrame(room).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([controls('P1', 1), controls('P2', -1)]);
  });

  it('rejects sequence replay, stale ticks and duplicate player input without poisoning future valid input', () => {
    const room = new AuthorizedSessionIngress(0, 2, 1);
    room.join('alice', 'P1');
    room.submit('alice', 7, 0, controls('P1'));
    expect(() => room.submit('alice', 8, 0, controls('P1', 1))).toThrow(/Duplicate/);
    expect(() => room.submit('alice', 7, 1, controls('P1'))).toThrow(/Replayed/);
    expect(() => room.submit('alice', 8, 3, controls('P1'))).toThrow(/future/i);
    room.submit('alice', 8, 1, controls('P1', -1));
    expect(consumeAuthorizedFrame(room).inputs).toEqual([controls('P1')]);
    expect(() => room.submit('alice', 9, 0, controls('P1'))).toThrow(/Stale/i);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([controls('P1', -1)]);
  });

  it('revokes pending controls on disconnect and refuses old-connection replay after reconnect', () => {
    const room = new AuthorizedSessionIngress(0, 3, 2);
    room.join('old', 'P1');
    room.join('peer', 'P2');
    room.submit('old', 12, 2, controls('P1', 1));
    room.submit('peer', 0, 2, controls('P2', -1));
    expect(room.disconnect('old')).toEqual(['P1']);
    expect(() => room.submit('old', 13, 2, controls('P1'))).toThrow(/Unauthorized/);
    room.join('fresh', 'P1');
    room.submit('fresh', 0, 2, controls('P1', -1));
    expect(consumeAuthorizedFrame(room).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([controls('P1', -1), controls('P2', -1)]);
    expect(() => room.assertHost('fresh')).toThrow(/Host authorization/);
  });

  it('enforces bounded queues and preserves state after rejected future flood', () => {
    const room = new AuthorizedSessionIngress(0, 2, 1);
    room.join('alice', 'P1');
    for (let tick = 3; tick < 500; tick++) {
      expect(() => room.submit('alice', tick, tick, controls('P1'))).toThrow(/future/i);
    }
    expect(room.bufferedTicks).toBe(0);
    room.submit('alice', 0, 2, controls('P1', 1));
    expect(room.bufferedTicks).toBe(1);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([]);
    expect(consumeAuthorizedFrame(room).inputs).toEqual([controls('P1', 1)]);
  });
});
