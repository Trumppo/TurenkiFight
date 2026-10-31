import { describe, expect, it } from 'vitest';
import { AuthorizedSessionIngress } from './authorizedSessionIngress';
import { consumeAuthorizedFrame } from './protocolIntegration';

const neutral = (playerId: string) => ({ playerId, moveX: 0 as const, moveY: 0 as const, jump: false });

describe('M2 session boundary invariants', () => {
  it('rejects roster overflow without modifying existing ownership', () => {
    const ingress = new AuthorizedSessionIngress(0, 1, 2);
    ingress.join('a', 'P1');
    ingress.join('b', 'P2');
    expect(() => ingress.join('c', 'P3')).toThrow(/full/);
    expect(ingress.playerCount).toBe(2);
    ingress.submit('a', 0, 0, neutral('P1'));
    ingress.submit('b', 0, 0, neutral('P2'));
    expect(consumeAuthorizedFrame(ingress).inputs.map(i => i.playerId)).toEqual(['P1', 'P2']);
  });

  it('rejects stale and future ticks without burning sequence numbers', () => {
    const ingress = new AuthorizedSessionIngress(5, 2, 1);
    ingress.join('a', 'P1');
    expect(() => ingress.submit('a', 7, 4, neutral('P1'))).toThrow(/Stale/);
    expect(() => ingress.submit('a', 7, 8, neutral('P1'))).toThrow(/future/);
    ingress.submit('a', 7, 7, neutral('P1'));
    expect(consumeAuthorizedFrame(ingress).tick).toBe(5);
    expect(consumeAuthorizedFrame(ingress).tick).toBe(6);
    expect(consumeAuthorizedFrame(ingress).inputs).toEqual([neutral('P1')]);
  });

  it('sorts accepted controls canonically regardless of packet order', () => {
    const ingress = new AuthorizedSessionIngress();
    ingress.join('c', 'P3');
    ingress.join('a', 'P1');
    ingress.join('b', 'P2');
    ingress.submit('c', 0, 0, neutral('P3'));
    ingress.submit('b', 0, 0, neutral('P2'));
    ingress.submit('a', 0, 0, neutral('P1'));
    expect(consumeAuthorizedFrame(ingress).inputs.map(i => i.playerId)).toEqual(['P1', 'P2', 'P3']);
  });
});
